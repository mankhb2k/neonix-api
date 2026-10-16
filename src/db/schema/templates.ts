import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { payouts } from "./payouts";

export const templateStatus = pgEnum("template_status", ["draft", "published", "unlisted"]);
export const versionStatus = pgEnum("template_version_status", [
  "pending_upload",
  "uploaded",
  "in_review",
  "approved",
  "rejected",
]);

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("general"),
  /** Credits charged per export; 0 = free. Set by the admin only. */
  creditCost: integer("credit_cost").notNull().default(6),
  /** VND the creator earns per export; fixed number set by the admin only. */
  creatorEarningVnd: integer("creator_earning_vnd").notNull().default(0),
  status: templateStatus("status").notNull().default("draft"),
  /** Version users get today; set on admin approval. Null = not listed yet. */
  currentVersionId: uuid("current_version_id"),
  /** Still image for cards and the viewer's first frame (public previews bucket). */
  posterKey: text("poster_key"),
  /** Optional short looping preview video, played for cards on screen (public previews bucket). */
  previewKey: text("preview_key"),
  useCount: integer("use_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("templates_creator_idx").on(table.creatorId),
  index("templates_listing_idx").on(table.status, table.category),
  check("templates_credit_cost_check", sql`${table.creditCost} >= 0`),
  check("templates_creator_earning_check", sql`${table.creatorEarningVnd} >= 0`),
]);

// Immutable once uploaded: a change is a new version, reviewed on its own.
export const templateVersions = pgTable("template_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => templates.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: versionStatus("status").notNull().default("pending_upload"),
  /** Object key in the private templates bucket. */
  packageKey: text("package_key").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  sha256: text("sha256"),
  /** Protocol V2 `formatVersion` the package targets. */
  formatVersion: integer("format_version").notNull().default(2),
  minAppVersion: text("min_app_version"),
  // Summary of manifest.json, declared by the creator at upload-complete. Display/filtering
  // only: never used for pricing or review. See docs/template-package.md.
  slotCount: integer("slot_count"),
  width: integer("width"),
  height: integer("height"),
  durationMs: integer("duration_ms"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("template_versions_template_version_unique").on(table.templateId, table.version),
  unique("template_versions_package_key_unique").on(table.packageKey),
]);

// A template a user has bought, once and for good: the first export pays the template's credit price and
// from then on every export of it is free. One row per (user, template). This row is also the sale record
// the creator's earning is paid from. Pro add-ons (later) are separate purchases on top of this one.
export const templatePurchases = pgTable("template_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" }),
  /** Version that was current when the user paid; later approved versions are theirs too. */
  versionId: uuid("version_id").references(() => templateVersions.id, { onDelete: "set null" }),
  creditsCharged: integer("credits_charged").notNull(),
  // Snapshots at purchase time, so later price/earning edits never rewrite history.
  creatorId: text("creator_id").references(() => user.id, { onDelete: "set null" }),
  creatorEarningVnd: integer("creator_earning_vnd").notNull().default(0),
  /** Set when the earning is included in a weekly payout. */
  payoutId: uuid("payout_id").references(() => payouts.id, { onDelete: "restrict" }),
  /** Exports so far, the paying one included. Free exports only bump this. */
  exportCount: integer("export_count").notNull().default(1),
  lastExportedAt: timestamp("last_exported_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("template_purchases_user_template_unique").on(table.userId, table.templateId),
  index("template_purchases_template_idx").on(table.templateId),
  index("template_purchases_creator_idx").on(table.creatorId, table.payoutId),
]);
