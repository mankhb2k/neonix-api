import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

// Web top-ups through payOS (VietQR). One row per payment link; the credits it will grant are fixed when the
// order is created, and the order flips to `paid` in the same transaction that writes the credit_ledger row.
export const topupOrders = pgTable("topup_orders", {
  orderCode: bigint("order_code", { mode: "number" }).primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  amountVnd: bigint("amount_vnd", { mode: "number" }).notNull(),
  credits: integer("credits").notNull(),
  status: text("status").notNull().default("pending"),
  paymentLinkId: text("payment_link_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (table) => [
  check("topup_orders_amount_vnd_check", sql`${table.amountVnd} > 0`),
  check("topup_orders_credits_check", sql`${table.credits} > 0`),
  check("topup_orders_status_check", sql`${table.status} in ('pending', 'paid', 'cancelled', 'expired')`),
  index("topup_orders_user_created_idx").on(table.userId, table.createdAt.desc()),
]);
