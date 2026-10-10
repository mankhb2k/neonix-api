import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Preserves the legacy Identity & Workspace schema contract, with
// every former `... uuid references auth.users(id)` column retyped to
// `text references "user"(id)` to match Better Auth's id format. RLS is
// dropped everywhere - Express enforces authorization instead (see
// the backend migration notes explaining why). Triggers that
// derived/enforced values (apply_account_plan_limits, enforce_*_quota,
// enforce_last_owner_guard, etc.) are NOT reimplemented as DB triggers here -
// they become explicit application-code checks in Phase 3, alongside the
// routes that need them.

export const profiles = pgTable("profiles", {
  id: text("id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  avatarPath: text("avatar_path"),
  avatarMimeType: text("avatar_mime_type"),
  avatarSizeBytes: bigint("avatar_size_bytes", { mode: "number" }),
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "profiles_avatar_size_bytes_check",
    sql`${table.avatarSizeBytes} is null or ${table.avatarSizeBytes} between 1 and 5242880`,
  ),
]);

export const accountPlans = pgTable("account_plans", {
  id: text("id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan").notNull().default("free"),
  maxActiveProjects: integer("max_active_projects").notNull().default(10),
  storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }).notNull().default(1073741824),
  maxUploadBytes: bigint("max_upload_bytes", { mode: "number" }).notNull().default(524288000),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("account_plans_plan_check", sql`${table.plan} in ('free', 'pro')`),
  check("account_plans_max_active_projects_check", sql`${table.maxActiveProjects} between 1 and 50`),
  check("account_plans_storage_quota_bytes_check", sql`${table.storageQuotaBytes} between 0 and 10737418240`),
  check("account_plans_max_upload_bytes_check", sql`${table.maxUploadBytes} between 1 and 2147483648`),
]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull().default("team"),
}, (table) => [
  check("workspaces_name_check", sql`char_length(btrim(${table.name})) between 1 and 120`),
  check("workspaces_kind_check", sql`${table.kind} in ('personal', 'team')`),
  uniqueIndex("workspaces_one_personal_per_owner")
    .on(table.createdBy)
    .where(sql`${table.kind} = 'personal'`),
]);

export const teamPlans = pgTable("team_plans", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  seatsPurchased: integer("seats_purchased").notNull().default(2),
  maxActiveProjects: integer("max_active_projects").notNull(),
  storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }).notNull(),
  maxUploadBytes: bigint("max_upload_bytes", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("team_plans_seats_purchased_check", sql`${table.seatsPurchased} >= 2`),
]);

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("editor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId] }),
  check("workspace_members_role_check", sql`${table.role} in ('owner', 'editor', 'viewer')`),
  uniqueIndex("workspace_members_one_owner_per_workspace")
    .on(table.workspaceId)
    .where(sql`${table.role} = 'owner'`),
]);
