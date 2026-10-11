import { bigint, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const payoutStatus = pgEnum("payout_status", ["pending", "paid"]);

// Vietnamese domestic bank account only (no international payouts yet).
export const creatorPayoutAccounts = pgTable("creator_payout_accounts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number").notNull(),
  accountHolder: text("account_holder").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per creator per week. Bank details are copied in, so a later change
// of account never alters a payout that is already being transferred.
export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  amountVnd: bigint("amount_vnd", { mode: "number" }).notNull(),
  exportsCount: integer("exports_count").notNull(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number").notNull(),
  accountHolder: text("account_holder").notNull(),
  status: payoutStatus("status").notNull().default("pending"),
  /** Bank transfer reference the admin enters after paying. */
  transferReference: text("transfer_reference"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("payouts_creator_period_unique").on(table.creatorId, table.periodEnd)]);
