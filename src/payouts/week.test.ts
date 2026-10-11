import { describe, expect, it } from "vitest";
import { lastFullWeek } from "./week";

describe("lastFullWeek", () => {
  it("returns the previous Mon-Sun week in Vietnam time", () => {
    // Wed 2026-10-14 10:00 +07 → previous week is Mon 2026-10-05 .. Mon 2026-10-12 (00:00 +07)
    const { start, end } = lastFullWeek(new Date("2026-10-14T03:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-04T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-11T17:00:00.000Z");
  });

  it("treats Sunday night UTC as already Monday in Vietnam", () => {
    // Sun 2026-10-11 18:00 UTC = Mon 2026-10-12 01:00 +07
    const { end } = lastFullWeek(new Date("2026-10-11T18:00:00Z"));
    expect(end.toISOString()).toBe("2026-10-11T17:00:00.000Z");
  });
});
