import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { corsMiddleware } from "./cors";

function run(origin: string | undefined, method = "GET") {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => void (headers[name] = value),
    vary: vi.fn(),
    status: vi.fn().mockReturnThis(),
    end: vi.fn(),
  } as unknown as Response;
  const next = vi.fn();
  const request = { method, headers: { origin, "access-control-request-headers": "x-dev-user" } } as unknown as Request;
  corsMiddleware(["http://localhost:3000"])(request, response, next);
  return { headers, response, next };
}

describe("corsMiddleware", () => {
  it("allows the website origin with credentials", () => {
    const { headers, next } = run("http://localhost:3000");
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(next).toHaveBeenCalled();
  });

  it("answers the preflight itself and echoes the requested headers", () => {
    const { headers, response, next } = run("http://localhost:3000", "OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toBe("x-dev-user");
    expect(response.status).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("adds nothing for other origins or non-browser callers", () => {
    expect(run("https://evil.example").headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(run(undefined).headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
