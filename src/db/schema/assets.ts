import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects } from "./projects";
import { workspaces } from "./identity";

// Preserves the legacy Assets & Media schema contract. Same
// text-vs-uuid user-id fix as identity.ts/projects.ts.

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull().unique(),
  contentHash: text("content_hash").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull().default("other"),
  status: text("status").notNull().default("ready"),
  storageBucket: text("storage_bucket").notNull().default("neonix-user-assets"),
  originalFilename: text("original_filename"),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  previewKey: text("preview_key"),
  previewStatus: text("preview_status").notNull().default("unsupported"),
  sourceDurationMs: bigint("source_duration_ms", { mode: "number" }),
  sourceWidth: integer("source_width"),
  sourceHeight: integer("source_height"),
  hasAudio: boolean("has_audio"),
  previewVersion: integer("preview_version"),
  previewError: text("preview_error"),
  mediaStatus: text("media_status").notNull().default("not_required"),
}, (table) => [
  check("assets_byte_size_check", sql`${table.byteSize} >= 0`),
  check("assets_kind_check", sql`${table.kind} in ('image', 'video', 'audio', 'font', 'other')`),
  check("assets_status_check", sql`${table.status} in ('uploading', 'ready', 'failed', 'deleting', 'deleted')`),
  check(
    "assets_preview_status_check",
    sql`${table.previewStatus} in ('pending', 'ready', 'failed', 'unsupported')`,
  ),
  check("assets_media_status_check", sql`${table.mediaStatus} in ('not_required', 'queued', 'processing', 'ready', 'partial', 'failed')`),
  check(
    "assets_preview_metadata_check",
    sql`(${table.sourceDurationMs} is null or ${table.sourceDurationMs} >= 0)
      and (${table.sourceWidth} is null or ${table.sourceWidth} > 0)
      and (${table.sourceHeight} is null or ${table.sourceHeight} > 0)
      and (${table.previewVersion} is null or ${table.previewVersion} >= 1)
      and ((${table.previewStatus} in ('pending', 'ready') and ${table.previewKey} is not null) or ${table.previewStatus} in ('failed', 'unsupported'))`,
  ),
  index("assets_workspace_idx").on(table.workspaceId),
  index("assets_workspace_status_idx")
    .on(table.workspaceId, table.status, table.createdAt.desc())
    .where(sql`${table.deletedAt} is null`),
  index("assets_preview_status_idx")
    .on(table.workspaceId, table.previewStatus)
    .where(sql`${table.deletedAt} is null`),
  index("assets_media_status_idx")
    .on(table.workspaceId, table.mediaStatus, table.createdAt.desc())
    .where(sql`${table.deletedAt} is null`),
  uniqueIndex("user_font_assets_filename_uidx")
    .on(table.workspaceId, sql`lower(btrim(${table.originalFilename}))`)
    .where(
      sql`${table.kind} = 'font' and ${table.originalFilename} is not null and ${table.deletedAt} is null and ${table.status} in ('uploading', 'ready')`,
    ),
  uniqueIndex("user_font_assets_content_hash_uidx")
    .on(table.workspaceId, table.contentHash)
    .where(
      sql`${table.kind} = 'font' and ${table.contentHash} not like 'pending:%' and ${table.deletedAt} is null and ${table.status} = 'ready'`,
    ),
]);

export const assetVariants = pgTable("asset_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  variantKind: text("variant_kind").notNull(),
  r2Key: text("r2_key").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  contentHash: text("content_hash").notNull(),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("asset_variants_variant_kind_check", sql`${table.variantKind} in ('thumbnail', 'proxy', 'waveform', 'poster', 'audio')`),
  check("asset_variants_byte_size_check", sql`${table.byteSize} >= 0`),
  uniqueIndex("asset_variants_asset_kind_uidx").on(table.assetId, table.variantKind),
  index("asset_variants_asset_idx").on(table.assetId),
]);

export const projectAssets = pgTable("project_assets", {
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "restrict" }),
  attachedBy: text("attached_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  attachedAt: timestamp("attached_at", { withTimezone: true }).notNull().defaultNow(),
  // Relative path inside the render bundle, e.g. "assets/video/clip.mp4". The HTML refers to the asset by this path.
  path: text("path"),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.assetId] }),
  index("project_assets_asset_idx").on(table.assetId),
]);

export const uploadSessions = pgTable("upload_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id")
    .notNull()
    .unique()
    .references(() => assets.id, { onDelete: "cascade" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expectedByteSize: bigint("expected_byte_size", { mode: "number" }),
  expectedMimeType: text("expected_mime_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expectedPreviewByteSize: bigint("expected_preview_byte_size", { mode: "number" }),
  expectedPreviewMimeType: text("expected_preview_mime_type"),
  previewKey: text("preview_key"),
}, (table) => [
  check("upload_sessions_status_check", sql`${table.status} in ('pending', 'uploading', 'completed', 'expired', 'failed')`),
  check("upload_sessions_expected_byte_size_check", sql`${table.expectedByteSize} is null or ${table.expectedByteSize} >= 0`),
  check(
    "upload_sessions_expected_preview_byte_size_check",
    sql`${table.expectedPreviewByteSize} is null or ${table.expectedPreviewByteSize} > 0`,
  ),
  check(
    "upload_sessions_completed_check",
    sql`(${table.status} <> 'completed') or ${table.completedAt} is not null`,
  ),
  index("upload_sessions_expiry_idx")
    .on(table.expiresAt)
    .where(sql`${table.status} in ('pending', 'uploading')`),
]);

export const mediaJobs = pgTable("media_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id")
    .notNull()
    .unique()
    .references(() => assets.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  sourceIntegrity: text("source_integrity").notNull(),
  pipelineVersion: integer("pipeline_version").notNull().default(1),
  attemptCount: integer("attempt_count").notNull().default(0),
  streamsJson: jsonb("streams_json").notNull().default([]),
  derivativesJson: jsonb("derivatives_json").notNull().default([]),
  lastError: text("last_error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  mediaKind: text("media_kind").notNull().default("video"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  sourceContentHash: text("source_content_hash"),
}, (table) => [
  check(
    "media_jobs_status_check",
    sql`${table.status} in ('queued', 'processing', 'retryable', 'ready', 'partial', 'failed')`,
  ),
  check("media_jobs_pipeline_version_check", sql`${table.pipelineVersion} >= 1`),
  check("media_jobs_attempt_count_check", sql`${table.attemptCount} >= 0`),
  check("media_jobs_media_kind_check", sql`${table.mediaKind} in ('audio', 'video')`),
  index("media_jobs_queue_idx")
    .on(table.status, table.createdAt)
    .where(sql`${table.status} in ('queued', 'processing')`),
  index("media_jobs_workspace_idx").on(table.workspaceId, table.createdAt.desc()),
  index("media_jobs_claim_idx")
    .on(table.status, table.leaseExpiresAt, table.createdAt)
    .where(sql`${table.status} in ('queued', 'retryable', 'processing')`),
]);

export const objectDeletionJobs = pgTable("object_deletion_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  storageBucket: text("storage_bucket").notNull(),
  objectKey: text("object_key").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  status: text("status").notNull().default("queued"),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  attemptCount: integer("attempt_count").notNull().default(0),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lastError: text("last_error"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "object_deletion_jobs_entity_type_check",
    sql`${table.entityType} in ('asset', 'asset_variant', 'project_export', 'upload')`,
  ),
  check(
    "object_deletion_jobs_status_check",
    sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
  ),
  check("object_deletion_jobs_attempt_count_check", sql`${table.attemptCount} >= 0`),
  uniqueIndex("object_deletion_jobs_bucket_key_uidx").on(table.storageBucket, table.objectKey),
  index("object_deletion_jobs_ready_idx")
    .on(table.runAfter, table.createdAt)
    .where(sql`${table.status} = 'queued'`),
]);
