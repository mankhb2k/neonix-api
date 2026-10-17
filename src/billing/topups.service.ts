import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import { CreditsService } from "../credits/credits.service";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { topupOrders } from "../db/schema/topups";
import { env } from "../env";
import { PayosService } from "./payos.service";

export const MIN_TOPUP_VND = 10_000;
export const MAX_TOPUP_VND = 50_000_000;

/** What `amountVnd` buys on the web: 1.000 VND = 10 credits (`VND_PER_CREDIT`, default 100). */
export function creditsForVnd(amountVnd: number, vndPerCredit = env.vndPerCredit): number {
  return Math.floor(amountVnd / vndPerCredit);
}

@Injectable()
export class TopupsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly credits: CreditsService,
    private readonly payos: PayosService,
  ) {}

  async createOrder(userId: string, origin: string, amountVnd: number) {
    // 13-digit millisecond timestamp + 3 random digits: unique, and inside Number.MAX_SAFE_INTEGER as payOS requires.
    const orderCode = Number(`${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`);
    const credits = creditsForVnd(amountVnd);
    const link = await this.payos.createPaymentLink({
      orderCode,
      amountVnd,
      description: `NX${orderCode}`,
      returnUrl: `${origin}/dashboard/topup?payos=success`,
      cancelUrl: `${origin}/dashboard/topup?payos=cancel`,
    });
    await this.db.insert(topupOrders).values({ orderCode, userId, amountVnd, credits, paymentLinkId: link.paymentLinkId });
    return {
      orderCode,
      status: "pending" as const,
      amountVnd,
      credits,
      qrCode: link.qrCode,
      checkoutUrl: link.checkoutUrl,
      accountNumber: link.accountNumber,
      accountName: link.accountName,
      description: link.description,
    };
  }

  /**
   * Marks the order paid and credits the wallet exactly once, however many times the webhook and the status poll
   * both report it. `paidAmountVnd` (from the webhook) must match what was ordered, otherwise nothing is credited.
   */
  async settle(orderCode: number, paidAmountVnd?: number): Promise<{ credited: boolean }> {
    return this.db.transaction(async (tx) => {
      const order = await tx.query.topupOrders.findFirst({ where: eq(topupOrders.orderCode, orderCode) });
      if (!order || order.status === "paid") return { credited: false };
      if (paidAmountVnd !== undefined && paidAmountVnd !== order.amountVnd) {
        console.error("[topups] paid amount differs from the order, not crediting", { orderCode, paidAmountVnd, ordered: order.amountVnd });
        return { credited: false };
      }
      const [paid] = await tx
        .update(topupOrders)
        .set({ status: "paid", paidAt: sql`now()` })
        .where(and(eq(topupOrders.orderCode, orderCode), sql`${topupOrders.status} <> 'paid'`))
        .returning();
      if (!paid) return { credited: false };
      await this.credits.applyDelta(tx, {
        userId: paid.userId,
        delta: paid.credits,
        reason: "purchase",
        refId: `payos_${paid.orderCode}`,
        idempotencyKey: `payos:${paid.orderCode}`,
      });
      return { credited: true };
    });
  }

  async getOrder(userId: string, orderCode: number) {
    let order = await this.db.query.topupOrders.findFirst({
      where: and(eq(topupOrders.orderCode, orderCode), eq(topupOrders.userId, userId)),
    });
    if (!order) throw new ApiError(404, "Order not found");

    if (order.status === "pending") {
      const remote = await this.payos.getPaymentStatus(orderCode).catch(() => null);
      if (remote === "PAID") {
        await this.settle(orderCode);
      } else if (remote === "CANCELLED" || remote === "EXPIRED") {
        await this.db
          .update(topupOrders)
          .set({ status: remote === "CANCELLED" ? "cancelled" : "expired" })
          .where(and(eq(topupOrders.orderCode, orderCode), eq(topupOrders.status, "pending")));
      }
      order = (await this.db.query.topupOrders.findFirst({ where: eq(topupOrders.orderCode, orderCode) })) ?? order;
    }
    return { orderCode: order.orderCode, status: order.status, amountVnd: order.amountVnd, credits: order.credits };
  }
}
