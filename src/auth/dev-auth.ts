import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { user } from "../db/schema/auth";
import { profiles } from "../db/schema/profile";
import { provisionNewUser } from "./provision";

const ROLES = ["user", "creator", "admin"] as const;

// DEV_AUTH_BYPASS only: creates the user on first sight and applies the requested role.
export async function ensureDevUser(id: string, role?: string): Promise<void> {
  await db.insert(user).values({ id, name: id, email: `${id}@dev.local` }).onConflictDoNothing();
  await provisionNewUser({ id, name: id });
  if (role && (ROLES as readonly string[]).includes(role)) {
    await db.update(profiles).set({ role: role as (typeof ROLES)[number] }).where(eq(profiles.id, id));
  }
}
