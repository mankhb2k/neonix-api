import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const userRole = pgEnum("user_role", ["user", "creator", "admin"]);

/** What an account is on. Every account is on the free trial (no end date) while the app is in open beta. */
export const userPlan = pgEnum("user_plan", ["free_trial", "lifetime"]);

// 1:1 with the Better Auth user. `role` is changed by hand/admin, never by the user.
export const profiles = pgTable("profiles", {
  id: text("id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  /** Object key in the public bucket (`avatars/{userId}/…`). */
  avatarKey: text("avatar_key"),
  role: userRole("role").notNull().default("user"),
  plan: userPlan("plan").notNull().default("free_trial"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
