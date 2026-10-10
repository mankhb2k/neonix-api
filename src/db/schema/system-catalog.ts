import { bigint, boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Preserves the `system_catalog` schema (font_families, font_files,
// system_assets) - real curated content (46 font families / 546 font files
// as of this port),
// not just a schema copy. R2 keys are unchanged: the actual font/asset bytes
// stay in the same `neonix-system-fonts`/`neonix-system-assets` R2 buckets,
// only this metadata catalog moves to Neon.
//
// Public font bytes are served by the separate `fonts.neonix.video`
// Cloudflare Worker directly from R2 (see FontsController's catalog route),
// not proxied through this API - only system_assets (a handful of fallback
// placeholders: image/svg/video/audio) are streamed through a route here,
// matching the old apps/web behavior.

export const systemFontFamilies = pgTable("system_font_families", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  familyName: text("family_name").notNull(),
  license: text("license").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  source: text("source").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const systemFontFiles = pgTable("system_font_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  fontFamilyId: uuid("font_family_id")
    .notNull()
    .references(() => systemFontFamilies.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  weight: integer("weight").notNull(),
  style: text("style").notNull().default("normal"),
  format: text("format").notNull().default("woff2"),
  storageBucket: text("storage_bucket").notNull().default("neonix-system-fonts"),
  r2Key: text("r2_key").notNull(),
  publicUrl: text("public_url"),
  contentHash: text("content_hash").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  isDefault: boolean("is_default").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  subfamilyName: text("subfamily_name"),
  postscriptName: text("postscript_name"),
  widthClass: text("width_class").notNull().default("normal"),
  axesJson: jsonb("axes_json").notNull().default({}),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  faceKey: text("face_key").notNull(),
});

export const systemAssets = pgTable("system_assets", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  kind: text("kind").notNull(),
  variantKind: text("variant_kind").notNull(),
  r2Key: text("r2_key").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull().default(0),
  width: integer("width"),
  height: integer("height"),
  durationMs: bigint("duration_ms", { mode: "number" }),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
