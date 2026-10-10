import { createHmac, randomUUID } from "node:crypto";
import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { db } from "../db/client";
import { DatabaseModule } from "../db/database.module";
import { walletLedger } from "../db/schema/misc";
import { seedUserGuard } from "../test/seed-user-guard";
import { BillingModule } from "./billing.module";
import { PolarService } from "./polar.service";

const seedUserId = process.env.SEED_USER_ID!;
process.env.POLAR_WEBHOOK_SECRET = "test-polar-webhook-secret";

let app: INestApplication;
const createTopupCheckout = () => Promise.resolve({ url: "https://polar.sh/checkout/test-session" });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, BillingModule] })
    .overrideProvider(PolarService)
    .useValue({ createTopupCheckout })
    .overrideGuard(CurrentUserGuard)
    .useValue(seedUserGuard(seedUserId))
    .compile();
  app = moduleRef.createNestApplication({ bodyParser: false });
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance.post("/webhooks/polar", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
});

afterEach(async () => {
  await db.delete(walletLedger).where(eq(walletLedger.userId, seedUserId));
});

afterAll(async () => {
  await app.close();
});

// Signs a raw body exactly like Polar's real webhook sender does (Standard
// Webhooks scheme: HMAC-SHA256 over `${id}.${timestamp}.${body}`, utf8 key
// bytes of the secret) - see @polar-sh/sdk's vendored verifySignature, read
// directly from dist/webhooks-*.cjs since it isn't otherwise documented in
// its public types. This lets the test exercise the real verification code
// path (not a mock) with a secret we control.
function signPolarWebhook(body: Buffer, webhookId: string, timestamp: number, secret: string): string {
  const signedContent = `${webhookId}.${timestamp}.${body.toString("utf8")}`;
  const signature = createHmac("sha256", Buffer.from(secret, "utf8")).update(signedContent).digest("base64");
  return `v1,${signature}`;
}

function orderPaidPayload(input: { orderId: string; userId?: string; amountCents?: number }) {
  return Buffer.from(
    JSON.stringify({
      type: "order.paid",
      data: {
        id: input.orderId,
        total_amount: input.amountCents ?? 1500,
        currency: "usd",
        metadata: input.userId ? { userId: input.userId } : {},
      },
    }),
    "utf8",
  );
}

// supertest/superagent JSON-serializes any non-string `.send()` payload
// whenever content-type looks like JSON - including a Buffer, via its own
// `toJSON()` (`{"type":"Buffer","data":[...]}`), which silently corrupts the
// exact bytes the signature covers. `.serialize(x => x)` overrides that with
// an identity function so the raw buffer goes over the wire untouched.
function postSignedWebhook(app: INestApplication, body: Buffer, webhookId: string, timestamp: number, signature: string) {
  return request(app.getHttpServer())
    .post("/webhooks/polar")
    .set("webhook-id", webhookId)
    .set("webhook-timestamp", String(timestamp))
    .set("webhook-signature", signature)
    .set("content-type", "application/json")
    .serialize((data: unknown) => data as string)
    .send(body);
}

describe("billing routes (Nest, real Neon dev DB, mocked Polar checkout)", () => {
  it("sums the wallet ledger for balance, ignoring other users", async () => {
    await db.insert(walletLedger).values([
      { userId: seedUserId, amountVnd: 250000, kind: "topup" },
      { userId: seedUserId, amountVnd: -50000, kind: "export_charge" },
    ]);

    const response = await request(app.getHttpServer()).get("/v1/billing/balance");
    expect(response.status).toBe(200);
    expect(response.body.balanceVnd).toBe(200000);
  });

  it("returns a zero balance for a user with no ledger rows", async () => {
    const response = await request(app.getHttpServer()).get("/v1/billing/balance");
    expect(response.status).toBe(200);
    expect(response.body.balanceVnd).toBe(0);
  });

  it("rejects a checkout amount outside the allowed USD range", async () => {
    const response = await request(app.getHttpServer()).post("/v1/billing/checkout").send({ amountUsd: 5000 });
    expect(response.status).toBe(400);
  });

  it("creates a checkout via the (mocked) Polar client", async () => {
    const response = await request(app.getHttpServer()).post("/v1/billing/checkout").send({ amountUsd: 25 });
    expect(response.status).toBe(200);
    expect(response.body.checkoutUrl).toBe("https://polar.sh/checkout/test-session");
  });
});

describe("POST /webhooks/polar (real HMAC signature verification, real Neon ledger credit)", () => {
  it("rejects a request with an invalid signature", async () => {
    const orderId = `order-${randomUUID()}`;
    const body = orderPaidPayload({ orderId, userId: seedUserId });
    const response = await postSignedWebhook(
      app,
      body,
      randomUUID(),
      Math.floor(Date.now() / 1000),
      "v1,not-a-real-signature",
    );
    expect(response.status).toBe(403);

    const rows = await db.query.walletLedger.findMany({ where: eq(walletLedger.externalRef, orderId) });
    expect(rows).toHaveLength(0);
  });

  it("credits the wallet ledger on a validly signed order.paid event", async () => {
    const orderId = `order-${randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const webhookId = randomUUID();
    const body = orderPaidPayload({ orderId, userId: seedUserId, amountCents: 2500 });
    const signature = signPolarWebhook(body, webhookId, timestamp, process.env.POLAR_WEBHOOK_SECRET!);

    const response = await postSignedWebhook(app, body, webhookId, timestamp, signature);

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);

    const [row] = await db.query.walletLedger.findMany({ where: eq(walletLedger.externalRef, orderId) });
    // 2500 cents = 25 USD, converted at the default 25000 VND per USD.
    expect(row.amountVnd).toBe(625000);
    expect(row.userId).toBe(seedUserId);
  });

  it("is idempotent: a retried delivery of the same order id credits nothing twice", async () => {
    const orderId = `order-${randomUUID()}`;
    const body = orderPaidPayload({ orderId, userId: seedUserId, amountCents: 1000 });

    const deliver = () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const webhookId = randomUUID();
      const signature = signPolarWebhook(body, webhookId, timestamp, process.env.POLAR_WEBHOOK_SECRET!);
      return postSignedWebhook(app, body, webhookId, timestamp, signature);
    };

    const first = await deliver();
    expect(first.status).toBe(200);
    const retry = await deliver();
    expect(retry.status).toBe(200);

    const rows = await db.query.walletLedger.findMany({ where: eq(walletLedger.externalRef, orderId) });
    expect(rows).toHaveLength(1);
  });

  it("accepts but ignores a validly signed event type other than order.paid", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const webhookId = randomUUID();
    const body = Buffer.from(JSON.stringify({ type: "checkout.created", data: { id: "irrelevant" } }), "utf8");
    const signature = signPolarWebhook(body, webhookId, timestamp, process.env.POLAR_WEBHOOK_SECRET!);

    const response = await postSignedWebhook(app, body, webhookId, timestamp, signature);

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);
  });

  it("accepts but does not credit an order.paid event missing metadata.userId", async () => {
    const orderId = `order-${randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const webhookId = randomUUID();
    const body = orderPaidPayload({ orderId });
    const signature = signPolarWebhook(body, webhookId, timestamp, process.env.POLAR_WEBHOOK_SECRET!);

    const response = await postSignedWebhook(app, body, webhookId, timestamp, signature);

    expect(response.status).toBe(200);
    expect(response.body.error).toBe("missing_user_metadata");

    const rows = await db.query.walletLedger.findMany({ where: eq(walletLedger.externalRef, orderId) });
    expect(rows).toHaveLength(0);
  });
});
