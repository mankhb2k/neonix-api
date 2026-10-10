import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces } from "./identity";

// Preserves the legacy Misc schema contract. Same text-vs-uuid
// user-id fix as the other schema files. wallet_ledger existed once already
// in the previous wallet-ledger definition with a uuid
// user_id - this is the corrected apps/api version, text-typed to match
// Better Auth's user.id; the legacy database type is historical only.

export const auditEvents = pgTable("audit_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
  actorClientId: text("actor_client_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_events_workspace_idx").on(table.workspaceId, table.createdAt.desc()),
]);

export const walletLedger = pgTable("wallet_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  // The wallet is kept in whole VND; USD (Polar) payments are converted when received.
  amountVnd: bigint("amount_vnd", { mode: "number" }).notNull(),
  kind: text("kind").notNull(),
  externalRef: text("external_ref"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("wallet_ledger_amount_vnd_check", sql`${table.amountVnd} <> 0`),
  check(
    "wallet_ledger_kind_check",
    sql`${table.kind} in ('topup', 'export_charge', 'refund', 'adjustment')`,
  ),
  uniqueIndex("wallet_ledger_external_ref_idx")
    .on(table.externalRef)
    .where(sql`${table.externalRef} is not null`),
  index("wallet_ledger_user_id_created_at_idx").on(table.userId, table.createdAt.desc()),
]);

// VND top-up orders paid through payOS. `order_code` is the integer payOS
// identifies a payment by; the webhook and status polling both resolve the
// owner and amount from this row, never from the request.
export const topupOrders = pgTable("topup_orders", {
  orderCode: bigint("order_code", { mode: "number" }).primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  amountVnd: bigint("amount_vnd", { mode: "number" }).notNull(),
  creditedVnd: bigint("credited_vnd", { mode: "number" }).notNull(),
  status: text("status").notNull().default("pending"),
  paymentLinkId: text("payment_link_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (table) => [
  check("topup_orders_amount_vnd_check", sql`${table.amountVnd} > 0`),
  check("topup_orders_status_check", sql`${table.status} in ('pending', 'paid', 'cancelled', 'expired')`),
  index("topup_orders_user_id_idx").on(table.userId, table.createdAt.desc()),
]);
