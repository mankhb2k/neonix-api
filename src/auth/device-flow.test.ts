import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
  });
});

import type { Database } from "../db/client";
import { schema } from "../db/client";
import { user } from "../db/schema/auth";
import { createAuth } from "./auth";

// The desktop sign-in against a real Postgres (PGlite) and the real plugin: code, approval in the browser, token, and the token as a Bearer session.
const GRANT = "urn:ietf:params:oauth:grant-type:device_code";
let client: PGlite;
let auth: ReturnType<typeof createAuth>;

async function browserHeaders(userId: string) {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
  return new Headers({ authorization: `Bearer ${session.token}` });
}

async function failureOf(promise: Promise<unknown>): Promise<{ status: string; body: { error?: string } }> {
  try {
    await promise;
  } catch (error) {
    const failure = error as { status: string; body: { error?: string } };
    return failure;
  }
  throw new Error("expected a failure");
}

beforeAll(async () => {
  client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: "drizzle" });
  auth = createAuth(pg as unknown as Database);
  await pg.insert(user).values([
    { id: "u1", name: "Ada", email: "ada@test.local" },
    { id: "u2", name: "Grace", email: "grace@test.local" },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe("device sign-in", () => {
  it("gives a code and an address on this server's /device page", async () => {
    const started = await auth.api.deviceCode({ body: { client_id: "neonix-desktop" } });
    expect(started.device_code.length).toBeGreaterThan(20);
    expect(started.user_code).toMatch(/^[A-Z2-9]{8}$/);
    expect(new URL(started.verification_uri).pathname).toBe("/device");
    expect(started.verification_uri_complete).toContain(`user_code=${started.user_code}`);
    expect(started.expires_in).toBeGreaterThan(0);
  });

  it("refuses a client that is not registered", async () => {
    const failure = await failureOf(auth.api.deviceCode({ body: { client_id: "someone-else" } }));
    expect(failure.body.error).toBe("invalid_client");
  });

  it("waits while nobody has approved", async () => {
    const started = await auth.api.deviceCode({ body: { client_id: "neonix-desktop" } });
    const failure = await failureOf(auth.api.deviceToken({ body: { grant_type: GRANT, device_code: started.device_code, client_id: "neonix-desktop" } }));
    expect(failure.body.error).toBe("authorization_pending");
  });

  it("hands the session token to the device once the user approves, and the token works as a Bearer", async () => {
    const started = await auth.api.deviceCode({ body: { client_id: "neonix-desktop" } });
    const headers = await browserHeaders("u1");
    await auth.api.deviceVerify({ query: { user_code: started.user_code }, headers });
    await auth.api.deviceApprove({ body: { userCode: started.user_code }, headers });

    const token = await auth.api.deviceToken({ body: { grant_type: GRANT, device_code: started.device_code, client_id: "neonix-desktop" } });
    expect(token.access_token).toBeTruthy();
    const session = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token.access_token}` }) });
    expect(session?.user.email).toBe("ada@test.local");
    expect(session?.user.name).toBe("Ada");
  });

  it("tells a denied sign-in", async () => {
    const started = await auth.api.deviceCode({ body: { client_id: "neonix-desktop" } });
    const headers = await browserHeaders("u1");
    await auth.api.deviceVerify({ query: { user_code: started.user_code }, headers });
    await auth.api.deviceDeny({ body: { userCode: started.user_code }, headers });
    const failure = await failureOf(auth.api.deviceToken({ body: { grant_type: GRANT, device_code: started.device_code, client_id: "neonix-desktop" } }));
    expect(failure.body.error).toBe("access_denied");
  });

  it("does not let another session approve a code that was claimed", async () => {
    const started = await auth.api.deviceCode({ body: { client_id: "neonix-desktop" } });
    await auth.api.deviceVerify({ query: { user_code: started.user_code }, headers: await browserHeaders("u1") });
    const failure = await failureOf(auth.api.deviceApprove({ body: { userCode: started.user_code }, headers: await browserHeaders("u2") }));
    expect(failure.status).toBe("FORBIDDEN");
  });

  it("needs a signed-in browser to approve", async () => {
    const started = await auth.api.deviceCode({ body: { client_id: "neonix-desktop" } });
    const failure = await failureOf(auth.api.deviceApprove({ body: { userCode: started.user_code }, headers: new Headers() }));
    expect(failure.status).toBe("UNAUTHORIZED");
  });

  it("does not hand a token out twice", async () => {
    const started = await auth.api.deviceCode({ body: { client_id: "neonix-desktop" } });
    const headers = await browserHeaders("u1");
    await auth.api.deviceVerify({ query: { user_code: started.user_code }, headers });
    await auth.api.deviceApprove({ body: { userCode: started.user_code }, headers });
    const body = { grant_type: GRANT, device_code: started.device_code, client_id: "neonix-desktop" };
    await auth.api.deviceToken({ body });
    const failure = await failureOf(auth.api.deviceToken({ body }));
    expect(["invalid_grant", "expired_token"]).toContain(failure.body.error);
  });

  it("refuses a device code that was never given", async () => {
    const failure = await failureOf(auth.api.deviceToken({ body: { grant_type: GRANT, device_code: "nope", client_id: "neonix-desktop" } }));
    expect(failure.body.error).toBe("invalid_grant");
  });
});

// The wire format the desktop app reads (NeonixQt/src/platform/qt/DeviceLoginProtocol.cpp): status codes and JSON of the real HTTP handler.
describe("device sign-in over HTTP", () => {
  const base = "http://localhost:8080/api/auth";
  const post = (path: string, body: unknown) =>
    auth.handler(new Request(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Neonix" }, body: JSON.stringify(body) }));

  it("answers the way the desktop reads it, from the code to who signed in", async () => {
    const codeReply = await post("/device/code", { client_id: "neonix-desktop" });
    expect(codeReply.status).toBe(200);
    const grant = (await codeReply.json()) as { device_code: string; user_code: string; verification_uri_complete: string; interval: number; expires_in: number };
    expect(typeof grant.device_code).toBe("string");
    expect(typeof grant.interval).toBe("number");
    expect(typeof grant.expires_in).toBe("number");
    expect(new URL(grant.verification_uri_complete).pathname).toBe("/device");

    const tokenBody = { grant_type: GRANT, device_code: grant.device_code, client_id: "neonix-desktop" };
    const pending = await post("/device/token", tokenBody);
    expect(pending.status).toBe(400);
    expect(((await pending.json()) as { error: string }).error).toBe("authorization_pending");

    // Asking again at once is "slow down"; the desktop waits the interval between polls, which is the minute that passes here.
    const tooSoon = await post("/device/token", tokenBody);
    expect(tooSoon.status).toBe(400);
    expect(((await tooSoon.json()) as { error: string }).error).toBe("slow_down");
    await client.query("update device_code set last_polled_at = (now() at time zone 'utc') - interval '1 minute'");

    const headers = await browserHeaders("u1");
    await auth.api.deviceVerify({ query: { user_code: grant.user_code }, headers });
    await auth.api.deviceApprove({ body: { userCode: grant.user_code }, headers });

    const tokenReply = await post("/device/token", tokenBody);
    expect(tokenReply.status).toBe(200);
    const token = ((await tokenReply.json()) as { access_token: string }).access_token;
    expect(typeof token).toBe("string");

    const who = await auth.handler(new Request(`${base}/get-session`, { headers: { authorization: `Bearer ${token}` } }));
    expect(who.status).toBe(200);
    const session = (await who.json()) as { user: { name: string; email: string } };
    expect(session.user).toMatchObject({ name: "Ada", email: "ada@test.local" });
  });

  it("refuses an unknown client with a 400 the desktop treats as a failure", async () => {
    const reply = await post("/device/code", { client_id: "nobody" });
    expect(reply.status).toBe(400);
    expect(((await reply.json()) as { error: string }).error).toBe("invalid_client");
  });

  it("ends a session when the desktop signs out", async () => {
    const context = await auth.$context;
    const session = await context.internalAdapter.createSession("u2");
    const out = await post("/sign-out", {});
    expect(out.status).toBeLessThan(500);
    const reply = await auth.handler(new Request(`${base}/sign-out`, { method: "POST", headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" }, body: "{}" }));
    expect(reply.status).toBe(200);
    const who = await auth.handler(new Request(`${base}/get-session`, { headers: { authorization: `Bearer ${session.token}` } }));
    expect(await who.json()).toBeNull();
  });
});
