import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import { env } from "../env";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { creatorPayoutAccounts, payouts } from "../db/schema/payouts";
import { templatePurchases } from "../db/schema/templates";
import { lastFullWeek } from "./week";

// Every purchase earns once, at the moment it is made; free exports afterwards are not sales.
function payableExports(creatorId: string, before: Date) {
  return and(
    eq(templatePurchases.creatorId, creatorId),
    isNull(templatePurchases.payoutId),
    sql`${templatePurchases.creatorEarningVnd} > 0`,
    lt(templatePurchases.createdAt, before),
  );
}

@Injectable()
export class PayoutsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // ---- creator ----

  async getAccount(creatorId: string) {
    return (await this.db.query.creatorPayoutAccounts.findFirst({ where: eq(creatorPayoutAccounts.userId, creatorId) })) ?? null;
  }

  async setAccount(creatorId: string, input: { bankName: string; accountNumber: string; accountHolder: string }) {
    const values = { ...input, accountHolder: input.accountHolder.toUpperCase(), updatedAt: new Date() };
    await this.db
      .insert(creatorPayoutAccounts)
      .values({ userId: creatorId, ...values })
      .onConflictDoUpdate({ target: creatorPayoutAccounts.userId, set: values });
    return this.getAccount(creatorId);
  }

  async earnings(creatorId: string) {
    const [unpaid] = await this.db
      .select({
        amount: sql<number>`coalesce(sum(${templatePurchases.creatorEarningVnd}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(templatePurchases)
      .where(payableExports(creatorId, new Date()));
    const [paid] = await this.db
      .select({ amount: sql<number>`coalesce(sum(${payouts.amountVnd}), 0)::bigint::float8` })
      .from(payouts)
      .where(and(eq(payouts.creatorId, creatorId), eq(payouts.status, "paid")));
    const history = await this.db.select().from(payouts).where(eq(payouts.creatorId, creatorId)).orderBy(desc(payouts.periodEnd)).limit(52);
    return {
      unpaidVnd: unpaid.amount,
      unpaidExports: unpaid.count,
      minPurchases: env.payoutMinPurchases,
      paidVnd: Number(paid.amount),
      payouts: history,
    };
  }

  // ---- admin ----

  /**
   * Weekly run (admin triggers it, e.g. every Monday): one pending payout per
   * creator for everything payable before the end of the last finished week.
   * Creators below `PAYOUT_MIN_PURCHASES` unpaid purchases, or without a bank
   * account, are skipped; their earnings accumulate and roll over to a later week.
   * Over the threshold, everything unpaid is paid (not just the threshold's worth).
   */
  async generateWeekly(now = new Date()) {
    const { start, end } = lastFullWeek(now);
    const creators = await this.db
      .selectDistinct({ creatorId: templatePurchases.creatorId })
      .from(templatePurchases)
      .where(and(isNull(templatePurchases.payoutId), sql`${templatePurchases.creatorId} is not null`, sql`${templatePurchases.creatorEarningVnd} > 0`));

    const created: { creatorId: string; amountVnd: number; exportsCount: number }[] = [];
    const skippedNoAccount: string[] = [];
    const skippedBelowThreshold: string[] = [];

    for (const { creatorId } of creators) {
      if (!creatorId) continue;
      const account = await this.getAccount(creatorId);
      if (!account) {
        skippedNoAccount.push(creatorId);
        continue;
      }
      const result = await this.db.transaction(async (tx) => {
        const already = await tx.query.payouts.findFirst({ where: and(eq(payouts.creatorId, creatorId), eq(payouts.periodEnd, end)) });
        if (already) return null;
        const rows = await tx.select({ id: templatePurchases.id, earning: templatePurchases.creatorEarningVnd }).from(templatePurchases).where(payableExports(creatorId, end)).for("update");
        if (rows.length === 0) return null;
        if (rows.length < env.payoutMinPurchases) {
          skippedBelowThreshold.push(creatorId);
          return null;
        }
        const amountVnd = rows.reduce((sum, r) => sum + r.earning, 0);
        const [payout] = await tx
          .insert(payouts)
          .values({
            creatorId,
            periodStart: start,
            periodEnd: end,
            amountVnd,
            exportsCount: rows.length,
            bankName: account.bankName,
            accountNumber: account.accountNumber,
            accountHolder: account.accountHolder,
          })
          .returning();
        await tx.update(templatePurchases).set({ payoutId: payout.id }).where(inArray(templatePurchases.id, rows.map((r) => r.id)));
        return { creatorId, amountVnd, exportsCount: rows.length };
      });
      if (result) created.push(result);
    }
    return { periodStart: start, periodEnd: end, created, skippedNoAccount, skippedBelowThreshold };
  }

  async list(status?: "pending" | "paid") {
    const rows = await this.db.select().from(payouts).where(status ? eq(payouts.status, status) : undefined).orderBy(desc(payouts.periodEnd)).limit(200);
    return { items: rows };
  }

  /** After the admin has made the bank transfer by hand. */
  async markPaid(id: string, transferReference: string) {
    const [row] = await this.db
      .update(payouts)
      .set({ status: "paid", transferReference, paidAt: new Date() })
      .where(and(eq(payouts.id, id), eq(payouts.status, "pending")))
      .returning();
    if (!row) throw new ApiError(409, "Payout not found or already paid", "BAD_STATE");
    return row;
  }
}
