import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import { afterCursor, msTrunc, toPage, type Cursor } from "../common/pagination";
import type { Database, Tx } from "../db/client";
import { DATABASE } from "../db/database.module";
import { creditLedger, creditWallets } from "../db/schema/credits";

type ApplyDeltaInput = {
  userId: string;
  delta: number;
  reason: (typeof creditLedger.$inferInsert)["reason"];
  refId?: string;
  /** Same key twice = same result, never a second debit/credit. */
  idempotencyKey: string;
  /** Refunds of already-spent credits may take the balance below zero. */
  allowNegative?: boolean;
};

// The ONLY place that changes a balance: wallet row locked, ledger row and
// new balance written together, so balance == sum(ledger.delta) always.
@Injectable()
export class CreditsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getBalance(userId: string): Promise<number> {
    const wallet = await this.db.query.creditWallets.findFirst({ where: eq(creditWallets.userId, userId) });
    return wallet?.balance ?? 0;
  }

  async listLedger(userId: string, limit: number, cursor?: Cursor) {
    const rows = await this.db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, userId), afterCursor(creditLedger.createdAt, creditLedger.id, cursor)))
      .orderBy(desc(msTrunc(creditLedger.createdAt)), desc(creditLedger.id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => ({ t: r.createdAt.toISOString(), id: r.id }));
  }

  /** Locks the user's wallet row until the transaction ends: serializes everything that spends or checks per user. */
  async lockWallet(tx: Tx, userId: string): Promise<void> {
    await tx.insert(creditWallets).values({ userId }).onConflictDoNothing();
    await tx.select().from(creditWallets).where(eq(creditWallets.userId, userId)).for("update");
  }

  /** Call inside `db.transaction`, together with whatever else must commit atomically with it. */
  async applyDelta(tx: Tx, input: ApplyDeltaInput): Promise<{ balance: number; replayed: boolean }> {
    await tx.insert(creditWallets).values({ userId: input.userId }).onConflictDoNothing();
    const [wallet] = await tx
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.userId, input.userId))
      .for("update");

    // After the lock, so two concurrent retries of one key serialize here.
    const existing = await tx.query.creditLedger.findFirst({
      where: eq(creditLedger.idempotencyKey, input.idempotencyKey),
    });
    if (existing) return { balance: existing.balanceAfter, replayed: true };

    const balance = wallet.balance + input.delta;
    if (balance < 0 && !input.allowNegative) {
      throw new ApiError(402, "Not enough credits", "INSUFFICIENT_CREDITS", { balance: wallet.balance, required: -input.delta });
    }
    await tx.update(creditWallets).set({ balance, updatedAt: new Date() }).where(eq(creditWallets.userId, input.userId));
    await tx.insert(creditLedger).values({
      userId: input.userId,
      delta: input.delta,
      balanceAfter: balance,
      reason: input.reason,
      refId: input.refId,
      idempotencyKey: input.idempotencyKey,
    });
    return { balance, replayed: false };
  }
}
