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
import { creditLedger } from "../db/schema/credits";
import { topupOrders } from "../db/schema/topups";
import type { PayosService } from "./payos.service";
import { TopupsService, creditsForVnd } from "./topups.service";

// Real Postgres (PGlite, in memory) with the real migrations: the exactly-once credit rule lives in SQL.
let client: PGlite;
let db: Database;
let credits: CreditsService;
let service: TopupsService;
let remoteStatus: "PAID" | "PENDING" | "CANCELLED" | null = "PENDING";

const fakePayos = {
  getChecksumKey: () => "key",
  createPaymentLink: async (input: { orderCode: number; amountVnd: number; description: string }) => ({
    paymentLinkId: `link-${input.orderCode}`,
    checkoutUrl: "https://pay.example/checkout",
    qrCode: "000201...",
    accountNumber: "123",
    accountName: "NEONIX",
    bin: "970422",
    amount: input.amountVnd,
    description: input.description,
  }),
  getPaymentStatus: async () => remoteStatus,
} as unknown as PayosService;

beforeAll(async () => {
  client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: "drizzle" });
  db = pg as unknown as Database;
  credits = new CreditsService(db);
  service = new TopupsService(db, credits, fakePayos);
  await db.insert(user).values([
    { id: "u1", name: "U1", email: "u1@test.local" },
    { id: "u2", name: "U2", email: "u2@test.local" },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe("web top-up pricing", () => {
  it("gives 10 credits for every 1.000 VND", () => {
    expect(creditsForVnd(1000)).toBe(10);
    expect(creditsForVnd(10_000)).toBe(100);
    expect(creditsForVnd(2_000_000)).toBe(20_000);
  });
});

describe("TopupsService", () => {
  it("creates a pending order that remembers the credits it will grant", async () => {
    const order = await service.createOrder("u1", "http://localhost:3000", 50_000);
    expect(order).toMatchObject({ status: "pending", amountVnd: 50_000, credits: 500, qrCode: "000201..." });
    const row = await db.query.topupOrders.findFirst({ where: eq(topupOrders.orderCode, order.orderCode) });
    expect(row).toMatchObject({ userId: "u1", credits: 500, status: "pending" });
    expect(await credits.getBalance("u1")).toBe(0);
  });

  it("credits exactly once, however many times a payment is reported", async () => {
    const { orderCode } = await service.createOrder("u1", "http://localhost:3000", 100_000);
    const first = await service.settle(orderCode, 100_000);
    const second = await service.settle(orderCode, 100_000);
    const third = await service.settle(orderCode);
    expect([first.credited, second.credited, third.credited]).toEqual([true, false, false]);
    // 500 from the first order stays pending, so only this order's 1.000 credits are in.
    expect(await credits.getBalance("u1")).toBe(1000);
    const entries = await db.select().from(creditLedger).where(eq(creditLedger.refId, `payos_${orderCode}`));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ delta: 1000, reason: "purchase", userId: "u1" });
  });

  it("refuses to credit when the paid amount differs from the order", async () => {
    const { orderCode } = await service.createOrder("u2", "http://localhost:3000", 20_000);
    expect((await service.settle(orderCode, 10_000)).credited).toBe(false);
    expect(await credits.getBalance("u2")).toBe(0);
    expect((await service.getOrder("u2", orderCode)).status).toBe("pending");
  });

  it("ignores order codes that are not ours", async () => {
    expect((await service.settle(999_999_999)).credited).toBe(false);
  });

  it("credits through the status poll when the webhook never arrives", async () => {
    const { orderCode } = await service.createOrder("u2", "http://localhost:3000", 30_000);
    remoteStatus = "PAID";
    const status = await service.getOrder("u2", orderCode);
    remoteStatus = "PENDING";
    expect(status).toMatchObject({ status: "paid", credits: 300 });
    expect(await credits.getBalance("u2")).toBe(300);
  });

  it("marks cancelled orders and never shows one user another user's order", async () => {
    const { orderCode } = await service.createOrder("u1", "http://localhost:3000", 10_000);
    remoteStatus = "CANCELLED";
    expect((await service.getOrder("u1", orderCode)).status).toBe("cancelled");
    remoteStatus = "PENDING";
    await expect(service.getOrder("u2", orderCode)).rejects.toMatchObject({ status: 404 });
  });
});
