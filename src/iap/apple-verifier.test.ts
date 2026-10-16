import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, { DATABASE_URL: "postgres://unused", BETTER_AUTH_SECRET: "test", GOOGLE_CLIENT_ID: "t", GOOGLE_CLIENT_SECRET: "t", DEV_AUTH_BYPASS: "true" });
});

import { env } from "../env";
import { decodeTransaction } from "./apple-verifier";

// Unsigned, as Xcode's StoreKit testing hands them out.
const jws = (payload: object) => ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");
const payload = (over: object = {}) => ({ transactionId: "1", originalTransactionId: "1", productId: "com.neonix.editor.credits.50", bundleId: env.appBundleId, environment: "Xcode", ...over });

describe("apple verifier (dev)", () => {
  beforeAll(() => {
    expect(env.devAuthBypass).toBe(true);
  });

  it("accepts an Xcode StoreKit transaction under DEV_AUTH_BYPASS", async () => {
    const tx = await decodeTransaction(jws(payload()));
    expect(tx.productId).toBe("com.neonix.editor.credits.50");
  });

  it("still rejects another app's bundle id", async () => {
    await expect(decodeTransaction(jws(payload({ bundleId: "com.someone.else" })))).rejects.toMatchObject({ status: 400 });
  });

  it("still rejects an unsigned transaction claiming a real environment", async () => {
    await expect(decodeTransaction(jws(payload({ environment: "Production" })))).rejects.toMatchObject({ status: 400 });
    await expect(decodeTransaction(jws(payload({ environment: "Sandbox" })))).rejects.toMatchObject({ status: 400 });
  });
});
