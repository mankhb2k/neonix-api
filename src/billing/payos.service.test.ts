import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// payos.service.ts reads env.ts, which insists on these at import time; nothing connects.
vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused",
    BETTER_AUTH_SECRET: "test",
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
  });
});

import { payosDataSignature, verifyPayosSignature } from "./payos.service";

const KEY = "test-checksum-key";
const data = { orderCode: 123, amount: 3000, description: "VQRIO123", reference: null, accountNumber: "12345678" };

describe("payOS webhook signature", () => {
  it("signs the sorted key=value pairs, with null as empty", () => {
    const expected = createHmac("sha256", KEY)
      .update("accountNumber=12345678&amount=3000&description=VQRIO123&orderCode=123&reference=")
      .digest("hex");
    expect(payosDataSignature(KEY, data)).toBe(expected);
  });

  it("accepts a valid signature and rejects a tampered one", () => {
    const signature = payosDataSignature(KEY, data);
    expect(verifyPayosSignature(KEY, data, signature)).toBe(true);
    expect(verifyPayosSignature(KEY, { ...data, amount: 1 }, signature)).toBe(false);
    expect(verifyPayosSignature(KEY, data, "bad")).toBe(false);
  });
});
