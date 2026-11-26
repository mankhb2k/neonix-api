import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused",
    BETTER_AUTH_SECRET: "test",
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
  });
});

import { CreditsService } from "../credits/credits.service";
import type { Database } from "../db/client";
import { schema } from "../db/client";
import { user } from "../db/schema/auth";
import { profiles } from "../db/schema/profile";
import type { R2Service } from "../r2/r2.service";
import { ProfileService } from "./profile.service";

// The plan an account is on, against a real Postgres (PGlite) with the real migrations.
let client: PGlite;
let db: Database;
let service: ProfileService;

const fakeR2 = { publicUrl: () => null } as unknown as R2Service;

beforeAll(async () => {
  client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: "drizzle" });
  db = pg as unknown as Database;
  service = new ProfileService(db, fakeR2, new CreditsService(db));
  await db.insert(user).values([
    { id: "new", name: "New", email: "new@test.local" },
    { id: "ends", name: "Older", email: "older@test.local" },
    { id: "life", name: "Life", email: "life@test.local" },
  ]);
  await db.insert(profiles).values([{ id: "new" }, { id: "ends" }, { id: "life" }]);
});

afterAll(async () => {
  await client.close();
});

describe("the plan of an account", () => {
  it("is the free trial for an account that was just made, with no end date to give", async () => {
    const profile = await service.get("new");
    expect(profile.plan).toBe("free_trial");
    expect(profile).not.toHaveProperty("trialEndsAt");
  });

  it("can be the lifetime plan", async () => {
    await db.update(profiles).set({ plan: "lifetime" }).where(eq(profiles.id, "life"));
    expect((await service.get("life")).plan).toBe("lifetime");
  });

  it("is not something the person can change by updating their profile", async () => {
    await service.update("new", { displayName: "Renamed", ...({ plan: "lifetime" } as object) });
    const profile = await service.get("new");
    expect(profile.displayName).toBe("Renamed");
    expect(profile.plan).toBe("free_trial");
  });

  it("is not found for an account that has no profile", async () => {
    await expect(service.get("nobody")).rejects.toMatchObject({ status: 404 });
  });

  it("is the free trial for a row written without a plan, as every profile that existed before the plan was added", async () => {
    const rows = await db.select({ plan: profiles.plan }).from(profiles).where(eq(profiles.id, "ends"));
    expect(rows[0]).toEqual({ plan: "free_trial" });
  });
});
