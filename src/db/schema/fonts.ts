import { sql } from "drizzle-orm";
import {
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
import { assets } from "./assets";
import { projects } from "./projects";
import { workspaces } from "./identity";

// Preserves the legacy User Fonts schema contract. Same
// text-vs-uuid user-id fix as the other schema files. Cross-table
// consistency checks (validate_user_font_asset, validate_project_user_font_family)
// were Postgres triggers - reimplemented as Express-side checks in Phase 3,
// not ported as DB triggers here.

export const userFontFamilies = pgTable("user_font_families", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  slug: text("slug").notNull(),
  familyName: text("family_name").notNull(),
  license: text("license"),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("user_font_families_slug_check", sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]{0,79}$'`),
  check(
    "user_font_families_family_name_check",
    sql`length(btrim(${table.familyName})) between 1 and 160`,
  ),
  uniqueIndex("user_font_families_workspace_slug_uidx").on(table.workspaceId, table.slug),
  uniqueIndex("user_font_families_workspace_name_uidx").on(
    table.workspaceId,
    sql`lower(${table.familyName})`,
  ),
  index("user_font_families_workspace_idx")
    .on(table.workspaceId, table.familyName)
    .where(sql`${table.enabled}`),
]);

export const userFontFaces = pgTable("user_font_faces", {
  id: uuid("id").primaryKey().defaultRandom(),
  fontFamilyId: uuid("font_family_id")
    .notNull()
    .references(() => userFontFamilies.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id")
    .notNull()
    .unique()
    .references(() => assets.id, { onDelete: "cascade" }),
  faceKey: text("face_key").notNull(),
  version: text("version").notNull().default("default"),
  weight: integer("weight").notNull(),
  style: text("style").notNull().default("normal"),
  widthClass: text("width_class").notNull().default("normal"),
  format: text("format").notNull(),
  subfamilyName: text("subfamily_name"),
  postscriptName: text("postscript_name"),
  axesJson: jsonb("axes_json").notNull().default({}),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  isDefault: boolean("is_default").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("user_font_faces_weight_check", sql`${table.weight} between 1 and 1000`),
  check("user_font_faces_style_check", sql`${table.style} in ('normal', 'italic', 'oblique')`),
  check(
    "user_font_faces_width_class_check",
    sql`${table.widthClass} in (
      'ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed',
      'normal',
      'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded'
    )`,
  ),
  check("user_font_faces_format_check", sql`${table.format} in ('woff2', 'woff', 'ttf')`),
  uniqueIndex("user_font_faces_family_face_uidx").on(table.fontFamilyId, table.faceKey),
  index("user_font_faces_lookup_idx")
    .on(table.fontFamilyId, table.widthClass, table.weight, table.style)
    .where(sql`${table.enabled}`),
]);

export const projectFontFamilies = pgTable("project_font_families", {
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  fontFamilyId: uuid("font_family_id")
    .notNull()
    .references(() => userFontFamilies.id, { onDelete: "cascade" }),
  alias: text("alias"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.fontFamilyId] }),
  check(
    "project_font_families_alias_check",
    sql`${table.alias} is null or length(btrim(${table.alias})) between 1 and 160`,
  ),
  index("project_font_families_project_idx")
    .on(table.projectId)
    .where(sql`${table.enabled}`),
]);
