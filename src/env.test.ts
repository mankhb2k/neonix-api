import { afterEach, describe, expect, it, vi } from "vitest";

describe("env", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("throws when a required var is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
    await expect(import("./env")).rejects.toThrow("Missing required env var DATABASE_URL");
  });

  it("loads all required vars when present", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
    const { env } = await import("./env");
    expect(env.databaseUrl).toBe("postgres://localhost/test");
  });
});
