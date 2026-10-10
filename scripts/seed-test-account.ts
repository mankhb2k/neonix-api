// Creates (or reuses) a real seed account for testing business routes
// before real auth is wired up. Runs through Better Auth's own in-process
// API (not raw SQL) so the provisionNewUser hook fires exactly like a real
// signup would - the seed account ends up with a profile, an account_plan,
// and a personal workspace, same as any real user.
//
// Usage: DATABASE_URL=... BETTER_AUTH_SECRET=... pnpm exec tsx scripts/seed-test-account.ts
import { eq } from "drizzle-orm";
import { auth } from "../src/auth/auth";
import { db, pool } from "../src/db/client";
import { user as userTable } from "../src/db/schema/auth";
import { workspaces } from "../src/db/schema/identity";

const SEED_EMAIL = process.env.SEED_EMAIL?.trim() || "seed-test-account@neonix.local";
const SEED_PASSWORD = process.env.SEED_PASSWORD || "seed-test-account-password-1234";
const SEED_NAME = process.env.SEED_NAME?.trim() || "Seed Test Account";

async function main() {
  let userId: string;
  const existing = await db.query.user.findFirst({ where: eq(userTable.email, SEED_EMAIL) });
  if (existing) {
    userId = existing.id;
    console.log(`[seed] reusing existing seed user ${userId}`);
  } else {
    const result = await auth.api.signUpEmail({
      body: { email: SEED_EMAIL, password: SEED_PASSWORD, name: SEED_NAME },
    });
    userId = result.user.id;
    console.log(`[seed] created seed user ${userId}`);
  }

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.createdBy, userId),
  });

  console.log("[seed] SEED_USER_ID=" + userId);
  console.log("[seed] SEED_WORKSPACE_ID=" + (workspace?.id ?? "(none found)"));
  await pool.end();
}

void main();
