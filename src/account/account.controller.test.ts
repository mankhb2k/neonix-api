import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { db } from "../db/client";
import { DatabaseModule } from "../db/database.module";
import { accountPlans } from "../db/schema/identity";
import { seedUserGuard } from "../test/seed-user-guard";
import { AccountModule } from "./account.module";

const seedUserId = process.env.SEED_USER_ID!;
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, AccountModule] })
    .overrideGuard(CurrentUserGuard)
    .useValue(seedUserGuard(seedUserId))
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe("account routes (Nest, real Neon dev DB)", () => {
  it("rejects an unauthenticated request", async () => {
    const publicModuleRef = await Test.createTestingModule({ imports: [DatabaseModule, AccountModule] }).compile();
    const publicApp = publicModuleRef.createNestApplication();
    await publicApp.init();
    const response = await request(publicApp.getHttpServer()).get("/v1/account/storage");
    expect(response.status).toBe(401);
    await publicApp.close();
  });

  it("reports storage usage/quota for the caller's personal workspace", async () => {
    const plan = await db.query.accountPlans.findFirst({ where: eq(accountPlans.id, seedUserId) });
    const response = await request(app.getHttpServer()).get("/v1/account/storage");
    expect(response.status).toBe(200);
    expect(response.body.quotaBytes).toBe(plan!.storageQuotaBytes);
    expect(response.body.usedBytes).toBeGreaterThanOrEqual(0);
    expect(response.body.availableBytes).toBe(Math.max(0, plan!.storageQuotaBytes - response.body.usedBytes));
    expect(response.body.usedPercent).toBeCloseTo((response.body.usedBytes / plan!.storageQuotaBytes) * 100, 5);
  });
});
