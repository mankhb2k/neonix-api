import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces } from "./identity";

// `public_ref`/`gen_random_bytes` need the pgcrypto extension enabled on the
// database (gen_random_uuid() is a Postgres builtin and needs nothing).

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicRef: text("public_ref")
    .notNull()
    .unique()
    .default(sql`'prj_' || encode(gen_random_bytes(10), 'hex')`),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Untitled project"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
  deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  deletionReason: text("deletion_reason"),
  storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }).notNull().default(1073741824),
  createIdempotencyKey: text("create_idempotency_key"),
  createIdempotencyHash: text("create_idempotency_hash"),
}, (table) => [
  check("projects_title_check", sql`char_length(btrim(${table.title})) between 1 and 200`),
  check("projects_storage_quota_bytes_check", sql`${table.storageQuotaBytes} between 0 and 1073741824`),
  check(
    "projects_lifecycle_check",
    sql`(${table.deletedAt} is null and ${table.purgeAfter} is null) or (${table.deletedAt} is not null and ${table.purgeAfter} is not null and ${table.purgeAfter} >= ${table.deletedAt})`,
  ),
  uniqueIndex("projects_create_idempotency_uidx")
    .on(table.workspaceId, table.createIdempotencyKey)
    .where(sql`${table.createIdempotencyKey} is not null and ${table.deletedAt} is null`),
]);

// HTML project storage: one row per project, overwritten in place on every
// update. There is no revision history.
export const projectHtmlDocuments = pgTable("project_html_documents", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  html: text("html").notNull(),
  contentHash: text("content_hash").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("project_html_documents_html_check", sql`char_length(${table.html}) > 0`),
  check("project_html_documents_byte_size_check", sql`${table.byteSize} > 0`),
]);
