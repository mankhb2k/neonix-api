import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import { afterCursor, msTrunc, toPage, type Cursor } from "../common/pagination";
import { CreditsService } from "../credits/credits.service";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { appleNotifications, creditPacks, iapTransactions } from "../db/schema/credits";
import { decodeNotification, decodeTransaction } from "./apple-verifier";

const REFUND_TYPES = ["REFUND", "REVOKE"];

@Injectable()
export class IapService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly credits: CreditsService,
  ) {}

  /** App sends the StoreKit 2 `jwsRepresentation` of a finished consumable purchase. */
  async verifyPurchase(userId: string, signedTransaction: string) {
    const tx = await decodeTransaction(signedTransaction);
    if (!tx.transactionId || !tx.originalTransactionId || !tx.productId) {
      throw new ApiError(400, "Malformed transaction", "INVALID_TRANSACTION");
    }
    if (tx.revocationDate) throw new ApiError(400, "Transaction was refunded", "REVOKED");
    // Inactive packs are still honoured: the user already paid for them.
    const pack = await this.db.query.creditPacks.findFirst({ where: eq(creditPacks.productId, tx.productId) });
    if (!pack) throw new ApiError(400, "Unknown product", "UNKNOWN_PRODUCT");
    const credits = pack.credits * (tx.quantity ?? 1);

    // A refund can reach us before the app ever verified the purchase.
    const refunded = await this.db.query.appleNotifications.findFirst({
      where: and(eq(appleNotifications.transactionId, tx.transactionId), inArray(appleNotifications.notificationType, REFUND_TYPES)),
    });
    if (refunded) throw new ApiError(400, "Transaction was refunded", "REVOKED");

    return this.db.transaction(async (trx) => {
      const inserted = await trx
        .insert(iapTransactions)
        .values({
          transactionId: tx.transactionId!,
          originalTransactionId: tx.originalTransactionId!,
          userId,
          productId: tx.productId!,
          credits,
          environment: String(tx.environment ?? "unknown"),
        })
        .onConflictDoNothing()
        .returning({ transactionId: iapTransactions.transactionId });

      if (inserted.length === 0) {
        const existing = await trx.query.iapTransactions.findFirst({
          where: eq(iapTransactions.transactionId, tx.transactionId!),
        });
        if (existing?.userId !== userId) throw new ApiError(409, "Transaction belongs to another account", "TRANSACTION_CLAIMED");
        return { credited: false, credits: existing.credits, balance: await this.credits.getBalance(userId) };
      }

      const { balance } = await this.credits.applyDelta(trx, {
        userId,
        delta: credits,
        reason: "purchase",
        refId: tx.transactionId,
        idempotencyKey: `iap:${tx.transactionId}`,
      });
      return { credited: true, credits, balance };
    });
  }

  async listPurchases(userId: string, limit: number, cursor?: Cursor) {
    const rows = await this.db
      .select()
      .from(iapTransactions)
      .where(and(eq(iapTransactions.userId, userId), afterCursor(iapTransactions.createdAt, iapTransactions.transactionId, cursor)))
      .orderBy(desc(msTrunc(iapTransactions.createdAt)), desc(iapTransactions.transactionId))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ t: r.createdAt.toISOString(), id: r.transactionId }));
  }

  /** App Store Server Notifications V2: record each one once; take back credits on refunds. */
  async handleNotification(signedPayload: string): Promise<void> {
    const notification = await decodeNotification(signedPayload);
    const type = String(notification.notificationType ?? "UNKNOWN");
    const uuid = notification.notificationUUID ?? createHash("sha256").update(signedPayload).digest("hex");
    const signedTransaction = notification.data?.signedTransactionInfo;
    const tx = REFUND_TYPES.includes(type) && signedTransaction ? await decodeTransaction(signedTransaction) : null;

    await this.db.transaction(async (trx) => {
      const recorded = await trx
        .insert(appleNotifications)
        .values({
          notificationUuid: uuid,
          notificationType: type,
          subtype: notification.subtype ? String(notification.subtype) : null,
          transactionId: tx?.transactionId ?? null,
          environment: notification.data?.environment ? String(notification.data.environment) : null,
        })
        .onConflictDoNothing()
        .returning({ id: appleNotifications.notificationUuid });
      if (recorded.length === 0 || !tx?.transactionId) return; // Apple retry, or nothing to refund

      const row = await trx.query.iapTransactions.findFirst({ where: eq(iapTransactions.transactionId, tx.transactionId) });
      if (!row || row.status === "refunded") return;
      await trx.update(iapTransactions).set({ status: "refunded" }).where(eq(iapTransactions.transactionId, row.transactionId));
      await this.credits.applyDelta(trx, {
        userId: row.userId,
        delta: -row.credits,
        reason: "iap_refund",
        refId: row.transactionId,
        idempotencyKey: `iap-refund:${row.transactionId}`,
        allowNegative: true,
      });
    });
  }
}
