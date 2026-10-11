import { describe, expect, it } from "vitest";
import { isWithinReexportWindow, reexportWindowEnd } from "./reexport-window";

describe("re-export window", () => {
  const paidAt = new Date("2026-10-10T10:00:00.000Z");

  it("is open for 30 minutes after the paid export", () => {
    expect(isWithinReexportWindow(paidAt, new Date("2026-10-10T10:29:59.000Z"))).toBe(true);
    expect(reexportWindowEnd(paidAt).toISOString()).toBe("2026-10-10T10:30:00.000Z");
  });

  it("is closed from the 30th minute on", () => {
    expect(isWithinReexportWindow(paidAt, new Date("2026-10-10T10:30:00.000Z"))).toBe(false);
    expect(isWithinReexportWindow(paidAt, new Date("2026-10-10T11:00:00.000Z"))).toBe(false);
  });
});
