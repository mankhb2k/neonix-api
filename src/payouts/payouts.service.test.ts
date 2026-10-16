import { PGlite } from "@electric-sql/pglite";
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// env.ts insists on these at import time; no real connection is made (the service gets the PGlite db).
vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused",
    BETTER_AUTH_SECRET: "test",
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
  });
});

import type { Database } from "../db/client";
import { schema } from "../db/client";
import { creatorPayoutAccounts, payouts } from "../db/schema/payouts";
import { templatePurchases } from "../db/schema/templates";
import { user } from "../db/schema/auth";
import { env } from "../env";
import { PayoutsService } from "./payouts.service";

// Real Postgres (PGlite, in memory) with the real migrations: the money rules live in SQL.
const EARNING = 300;
const CREATOR = "creator-1";
const NOW = new Date("2026-10-14T05:00:00.000Z"); // Wednesday: the last full week is Mon 5 Oct - Mon 12 Oct (Vietnam time)
const IN_WEEK = new Date("2026-10-08T05:00:00.000Z");
const AFTER_WEEK = new Date("2026-10-13T05:00:00.000Z");
const NEXT_RUN = new Date("2026-10-21T05:00:00.000Z"); // the Wednesday after: covers up to Mon 19 Oct

let client: PGlite;
let db: Database;
let service: PayoutsService;

async function addPurchases(count: number, createdAt: Date, creatorId = CREATOR, earning = EARNING) {
  await db.insert(templatePurchases).values(
    Array.from({ length: count }, () => ({ userId: "buyer", creditsCharged: 6, creatorId, creatorEarningVnd: earning, createdAt })),
  );
}

async function addBankAccount(creatorId = CREATOR) {
  await service.setAccount(creatorId, { bankName: "Vietcombank", accountNumber: "0123456789", accountHolder: "Creator One" });
}

beforeAll(async () => {
  client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: "drizzle" });
  db = pg as unknown as Database;
  service = new PayoutsService(db);
  await db.insert(user).values([
    { id: CREATOR, name: "Creator", email: "creator@test.local" },
    { id: "creator-2", name: "Creator 2", email: "creator2@test.local" },
    { id: "buyer", name: "Buyer", email: "buyer@test.local" },
  ]);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  env.payoutMinPurchases = 100;
  await db.delete(templatePurchases);
  await db.delete(payouts);
  await db.delete(creatorPayoutAccounts);
});

describe("weekly payout threshold", () => {
  it("pays nothing below the threshold and keeps the purchases unpaid", async () => {
    await addBankAccount();
    await addPurchases(99, IN_WEEK);

    const result = await service.generateWeekly(NOW);

    expect(result.created).toEqual([]);
    expect(result.skippedBelowThreshold).toEqual([CREATOR]);
    expect(await db.select().from(payouts)).toHaveLength(0);
    expect(await db.select().from(templatePurchases).where(isNull(templatePurchases.payoutId))).toHaveLength(99);
  });

  it("pays exactly at the threshold: 100 x 300 = 30,000", async () => {
    await addBankAccount();
    await addPurchases(100, IN_WEEK);

    const result = await service.generateWeekly(NOW);

    expect(result.created).toEqual([{ creatorId: CREATOR, amountVnd: 30_000, exportsCount: 100 }]);
  });

  it("pays everything over the threshold, not just the threshold's worth: 101 x 300 = 30,300", async () => {
    await addBankAccount();
    await addPurchases(101, IN_WEEK);

    const result = await service.generateWeekly(NOW);

    expect(result.created[0]).toMatchObject({ amountVnd: 30_300, exportsCount: 101 });
  });

  it("accumulates across weeks until the total reaches the threshold", async () => {
    await addBankAccount();
    await addPurchases(60, IN_WEEK);
    expect((await service.generateWeekly(NOW)).created).toEqual([]);

    await addPurchases(50, new Date("2026-10-15T05:00:00.000Z")); // the following week
    const second = await service.generateWeekly(NEXT_RUN);

    expect(second.created).toEqual([{ creatorId: CREATOR, amountVnd: 33_000, exportsCount: 110 }]);
  });

  it("keeps a creator without a bank account accumulating, then pays once they add one", async () => {
    await addPurchases(150, IN_WEEK);

    const first = await service.generateWeekly(NOW);
    expect(first.skippedNoAccount).toEqual([CREATOR]);
    expect(first.created).toEqual([]);

    await addBankAccount();
    const second = await service.generateWeekly(NEXT_RUN);
    expect(second.created[0]).toMatchObject({ amountVnd: 45_000, exportsCount: 150 });
  });

  it("leaves purchases made after the week's end for the next run", async () => {
    await addBankAccount();
    await addPurchases(100, IN_WEEK);
    await addPurchases(30, AFTER_WEEK);

    const result = await service.generateWeekly(NOW);

    expect(result.created[0]).toMatchObject({ exportsCount: 100 });
    expect(await db.select().from(templatePurchases).where(isNull(templatePurchases.payoutId))).toHaveLength(30);
  });

  it("ignores purchases that earn nothing", async () => {
    await addBankAccount();
    await addPurchases(200, IN_WEEK, CREATOR, 0);

    const result = await service.generateWeekly(NOW);

    expect(result.created).toEqual([]);
    expect(result.skippedBelowThreshold).toEqual([]);
  });

  it("judges each creator on their own count", async () => {
    await addBankAccount("creator-1");
    await addBankAccount("creator-2");
    await addPurchases(120, IN_WEEK, "creator-1");
    await addPurchases(40, IN_WEEK, "creator-2");

    const result = await service.generateWeekly(NOW);

    expect(result.created.map((c) => c.creatorId)).toEqual(["creator-1"]);
    expect(result.skippedBelowThreshold).toEqual(["creator-2"]);
  });

  it("follows PAYOUT_MIN_PURCHASES", async () => {
    env.payoutMinPurchases = 1000;
    await addBankAccount();
    await addPurchases(999, IN_WEEK);
    expect((await service.generateWeekly(NOW)).created).toEqual([]);

    await addPurchases(1, IN_WEEK);
    expect((await service.generateWeekly(NOW)).created[0]).toMatchObject({ amountVnd: 300_000, exportsCount: 1000 });
  });
});

describe("reset after paying", () => {
  it("links every paid purchase to the payout, so none counts again", async () => {
    await addBankAccount();
    await addPurchases(100, IN_WEEK);
    await service.generateWeekly(NOW);

    const [payout] = await db.select().from(payouts);
    const rows = await db.select().from(templatePurchases);
    expect(rows.every((r) => r.payoutId === payout.id)).toBe(true);
    expect(await service.earnings(CREATOR)).toMatchObject({ unpaidVnd: 0, unpaidExports: 0 });
  });

  it("never pays the same week twice, however often the run is repeated", async () => {
    await addBankAccount();
    await addPurchases(100, IN_WEEK);

    await service.generateWeekly(NOW);
    const again = await service.generateWeekly(NOW);
    await Promise.all([service.generateWeekly(NOW), service.generateWeekly(NOW)]);

    expect(again.created).toEqual([]);
    expect(await db.select().from(payouts)).toHaveLength(1);
  });

  it("starts counting from zero afterwards", async () => {
    await addBankAccount();
    await addPurchases(100, IN_WEEK);
    await service.generateWeekly(NOW);

    await addPurchases(40, new Date("2026-10-15T05:00:00.000Z"));
    const next = await service.generateWeekly(NEXT_RUN);

    expect(next.created).toEqual([]);
    expect(next.skippedBelowThreshold).toEqual([CREATOR]);
    expect(await service.earnings(CREATOR)).toMatchObject({ unpaidVnd: 12_000, unpaidExports: 40 });
  });

  it("refuses to delete a payout that purchases point to", async () => {
    await addBankAccount();
    await addPurchases(100, IN_WEEK);
    await service.generateWeekly(NOW);
    const [payout] = await db.select().from(payouts);

    await expect(db.delete(payouts).where(eq(payouts.id, payout.id))).rejects.toThrow();
    expect(await db.select().from(templatePurchases).where(isNull(templatePurchases.payoutId))).toHaveLength(0);
  });
});

describe("paying out (mark paid)", () => {
  async function pendingPayout() {
    await addBankAccount();
    await addPurchases(100, IN_WEEK);
    await service.generateWeekly(NOW);
    const [payout] = await db.select().from(payouts);
    return payout;
  }

  it("copies the bank details and starts as pending", async () => {
    const payout = await pendingPayout();
    expect(payout).toMatchObject({ status: "pending", amountVnd: 30_000, bankName: "Vietcombank", accountHolder: "CREATOR ONE", transferReference: null });
  });

  it("marks it paid with the transfer reference", async () => {
    const payout = await pendingPayout();

    const paid = await service.markPaid(payout.id, "FT26101400123");

    expect(paid).toMatchObject({ status: "paid", transferReference: "FT26101400123" });
    expect(paid.paidAt).toBeInstanceOf(Date);
    expect(await service.earnings(CREATOR)).toMatchObject({ paidVnd: 30_000, unpaidVnd: 0 });
  });

  it("refuses to pay twice", async () => {
    const payout = await pendingPayout();
    await service.markPaid(payout.id, "FT1");

    await expect(service.markPaid(payout.id, "FT2")).rejects.toMatchObject({ status: 409 });
    expect((await db.select().from(payouts))[0].transferReference).toBe("FT1");
  });

  it("a later bank account change does not alter a payout already made", async () => {
    const payout = await pendingPayout();
    await service.setAccount(CREATOR, { bankName: "Techcombank", accountNumber: "9999999999", accountHolder: "Someone Else" });

    const [row] = await db.select().from(payouts).where(eq(payouts.id, payout.id));
    expect(row.bankName).toBe("Vietcombank");
  });

  it("lists pending and paid payouts separately", async () => {
    const payout = await pendingPayout();
    expect((await service.list("pending")).items).toHaveLength(1);
    await service.markPaid(payout.id, "FT1");
    expect((await service.list("pending")).items).toHaveLength(0);
    expect((await service.list("paid")).items).toHaveLength(1);
  });
});
