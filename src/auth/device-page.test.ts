import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused",
    BETTER_AUTH_SECRET: "test",
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
  });
});

import { deviceClients } from "./auth";
import { devicePageHtml } from "./device-page";

describe("the device page", () => {
  const html = devicePageHtml();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";

  it("has a script that parses", () => {
    expect(script.length).toBeGreaterThan(100);
    expect(() => new Function(script)).not.toThrow();
  });

  it("names the apps the server accepts, and no template text is left over", () => {
    for (const id of Object.keys(deviceClients)) expect(html).toContain(id);
    expect(html).not.toContain("${");
  });

  it("puts what it shows in as text, never as markup", () => {
    expect(script).not.toMatch(/innerHTML|document\.write|outerHTML/);
  });
});
