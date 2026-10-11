import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const ledgerReason = pgEnum("ledger_reason", ["purchase", "export", "export_refund", "iap_refund", "grant", "template_purchase"]);
export const iapStatus = pgEnum("iap_status", ["credited", "refunded"]);

// Cached balance. Only credits/credits.service.ts writes it, in the same
// transaction as the matching credit_ledger row, so balance == sum(ledger.delta).
export const creditWallets = pgTable("credit_wallets", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only. `idempotencyKey` makes every credit/debit safe to retry.
export const creditLedger = pgTable("credit_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: ledgerReason("reason").notNull(),
  /** Id of the thing that caused it (iap transaction id, export id). */
  refId: text("ref_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("credit_ledger_user_created_idx").on(table.userId, table.createdAt),
  check("credit_ledger_delta_nonzero", sql`${table.delta} <> 0`),
]);

// One row per Apple transaction (primary key = Apple `transactionId`), so the
// same purchase can never be credited twice.
export const iapTransactions = pgTable("iap_transactions", {
  transactionId: text("transaction_id").primaryKey(),
  originalTransactionId: text("original_transaction_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  credits: integer("credits").notNull(),
  environment: text("environment").notNull(),
  status: iapStatus("status").notNull().default("credited"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Sellable credit packs, keyed by the App Store Connect product id. The app shows these
// (price text comes from StoreKit); IapService credits `credits` per unit bought.
// An inactive pack is hidden from the shop but still honoured for purchases already made.
export const creditPacks = pgTable("credit_packs", {
  productId: text("product_id").primaryKey(),
  credits: integer("credits").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("credit_packs_credits_check", sql`${table.credits} > 0`)]);

// Every App Store Server Notification we received: dedupes Apple's retries and lets a
// refund that arrives before the app verified the purchase still be honoured.
export const appleNotifications = pgTable("apple_notifications", {
  notificationUuid: text("notification_uuid").primaryKey(),
  notificationType: text("notification_type").notNull(),
  subtype: text("subtype"),
  transactionId: text("transaction_id"),
  environment: text("environment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("apple_notifications_transaction_idx").on(table.transactionId)]);
