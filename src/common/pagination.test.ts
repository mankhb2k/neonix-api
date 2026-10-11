import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, parseLimit, toPage } from "./pagination";

describe("pagination", () => {
  it("round-trips a cursor and rejects garbage", () => {
    const cursor = { t: "2026-10-10T10:00:00.000Z", id: "abc" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(() => decodeCursor("not-a-cursor")).toThrow();
  });

  it("clamps limits", () => {
    expect(parseLimit(undefined, 20, 50)).toBe(20);
    expect(parseLimit("500", 20, 50)).toBe(50);
    expect(parseLimit("-3", 20, 50)).toBe(20);
  });

  it("returns nextCursor only when there is another page", () => {
    const row = (n: number) => ({ id: String(n), at: "2026-10-10T10:00:00.000Z" });
    const cursorOf = (r: { id: string; at: string }) => ({ t: r.at, id: r.id });
    expect(toPage([row(1), row(2), row(3)], 2, cursorOf).nextCursor).not.toBeNull();
    expect(toPage([row(1), row(2)], 2, cursorOf)).toEqual({ items: [row(1), row(2)], nextCursor: null });
  });
});
