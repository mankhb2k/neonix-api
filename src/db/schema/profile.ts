import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const userRole = pgEnum("user_role", ["user", "creator", "admin"]);

// 1:1 with the Better Auth user. `role` is changed by hand/admin, never by the user.
export const profiles = pgTable("profiles", {
  id: text("id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  /** Object key in the public bucket (`avatars/{userId}/…`). */
  avatarKey: text("avatar_key"),
  role: userRole("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
