import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { isUniqueViolation } from "../common/pg-errors";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { user } from "../db/schema/auth";
import { topupOrders, walletLedger } from "../db/schema/misc";
import { ApiError } from "../common/api-error";
import { PayosService } from "./payos.service";
import { PolarService } from "./polar.service";

@Injectable()
export class BillingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly polar: PolarService,
    private readonly payos: PayosService,
  ) {}

  // Balance is derived by summing the ledger, never stored as a mutable
  // counter - preserves the previous wallet-balance semantics.
  async getBalanceVnd(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ sum: sql<string>`coalesce(sum(${walletLedger.amountVnd}), 0)` })
      .from(walletLedger)
      .where(eq(walletLedger.userId, userId));
    return Number(row?.sum ?? 0);
  }

  // One fixed rate (VND per 1 USD) converts every USD amount into the VND
  // wallet at the moment it is received.
  private vndPerUsd(): number {
    const rate = Number(process.env.VND_PER_USD);
    return Number.isFinite(rate) && rate > 0 ? rate : 25_000;
  }

  async createTopupCheckout(userId: string, origin: string, amountUsd: number): Promise<{ checkoutUrl: string }> {
    const account = await this.db.query.user.findFirst({ where: eq(user.id, userId) });
    const amountCents = Math.round(amountUsd * 100);
    try {
      const { url } = await this.polar.createTopupCheckout({
        userId,
        email: account?.email,
        amountCents,
        successUrl: `${origin}/dashboard/topup?checkout=success`,
        embedOrigin: origin || undefined,
      });
      return { checkoutUrl: url };
    } catch (error) {
      // Polar rejects amounts below the product's configured minimum, among
      // other things; surface a clear 502 instead of an opaque 500.
      console.error("[billing] Polar checkout failed", error);
      throw new ApiError(502, "Couldn't start the card checkout", "polar_checkout_failed");
    }
  }

  // external_ref (the Polar order id) is unique - a retried webhook delivery
  // hits the conflict below and credits nothing twice.
  async creditFromPolarOrder(input: {
    userId: string;
    amountCents: number;
    orderId: string;
  }): Promise<{ credited: boolean }> {
    const rate = this.vndPerUsd();
    try {
      await this.db.insert(walletLedger).values({
        userId: input.userId,
        amountVnd: Math.round((input.amountCents * rate) / 100),
        kind: "topup",
        externalRef: input.orderId,
        metadata: { source: "polar", amountCents: input.amountCents, vndPerUsd: rate },
      });
      return { credited: true };
    } catch (error) {
      if (isUniqueViolation(error)) return { credited: false };
      throw error;
    }
  }

  // ── VND top-ups through payOS ───────────────────────────────────────

  async createPayosOrder(userId: string, origin: string, amountVnd: number) {
    // 13-digit millisecond timestamp + 3 random digits: unique, and well
    // inside Number.MAX_SAFE_INTEGER, which payOS requires of an orderCode.
    const orderCode = Number(`${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`);
    const link = await this.payos.createPaymentLink({
      orderCode,
      amountVnd,
      description: `NX${orderCode}`,
      returnUrl: `${origin}/dashboard/topup?payos=success`,
      cancelUrl: `${origin}/dashboard/topup?payos=cancel`,
    });
    await this.db.insert(topupOrders).values({
      orderCode,
      userId,
      amountVnd,
      creditedVnd: amountVnd,
      paymentLinkId: link.paymentLinkId,
    });
    return {
      orderCode,
      status: "pending" as const,
      amountVnd,
      qrCode: link.qrCode,
      checkoutUrl: link.checkoutUrl,
      accountNumber: link.accountNumber,
      accountName: link.accountName,
      description: link.description,
    };
  }

  // Marks the order paid and credits the wallet exactly once, however many
  // times the webhook and the status poll both report it.
  async settlePayosOrder(orderCode: number): Promise<{ credited: boolean }> {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .update(topupOrders)
        .set({ status: "paid", paidAt: sql`now()` })
        .where(and(eq(topupOrders.orderCode, orderCode), sql`${topupOrders.status} <> 'paid'`))
        .returning();
      if (!order) return { credited: false };
      await tx.insert(walletLedger).values({
        userId: order.userId,
        amountVnd: order.creditedVnd,
        kind: "topup",
        externalRef: `payos_${order.orderCode}`,
        metadata: { source: "payos" },
      });
      return { credited: true };
    });
  }

  async getPayosOrder(userId: string, orderCode: number) {
    let order = await this.db.query.topupOrders.findFirst({
      where: and(eq(topupOrders.orderCode, orderCode), eq(topupOrders.userId, userId)),
    });
    if (!order) throw new ApiError(404, "Order not found");

    if (order.status === "pending") {
      const remote = await this.payos.getPaymentStatus(orderCode).catch(() => null);
      if (remote === "PAID") {
        await this.settlePayosOrder(orderCode);
      } else if (remote === "CANCELLED" || remote === "EXPIRED") {
        await this.db
          .update(topupOrders)
          .set({ status: remote === "CANCELLED" ? "cancelled" : "expired" })
          .where(and(eq(topupOrders.orderCode, orderCode), eq(topupOrders.status, "pending")));
      }
      order = (await this.db.query.topupOrders.findFirst({ where: eq(topupOrders.orderCode, orderCode) })) ?? order;
    }
    return { orderCode: order.orderCode, status: order.status, amountVnd: order.amountVnd };
  }
}
