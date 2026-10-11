import { and, lt, or, sql, type AnyColumn } from "drizzle-orm";
import { ApiError } from "./api-error";

// Keyset pagination on (timestamp desc, id desc). The cursor is opaque to clients:
// they pass back `nextCursor` as `?cursor=`. Timestamps are compared at millisecond
// precision because JS Dates cannot carry Postgres' microseconds.
export type Cursor = { t: string; id: string };

export function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof value.t === "string" && typeof value.id === "string" && !Number.isNaN(Date.parse(value.t))) {
      return { t: value.t, id: value.id };
    }
  } catch {
    // fall through
  }
  throw new ApiError(400, "Invalid cursor", "INVALID_CURSOR");
}

export const msTrunc = (column: AnyColumn) => sql`date_trunc('milliseconds', ${column})`;

/** WHERE clause for "rows after this cursor" in (timestamp desc, id desc) order. */
export function afterCursor(timeColumn: AnyColumn, idColumn: AnyColumn, cursor: Cursor | undefined) {
  if (!cursor) return undefined;
  const at = new Date(cursor.t);
  return or(sql`${msTrunc(timeColumn)} < ${at}`, and(sql`${msTrunc(timeColumn)} = ${at}`, lt(idColumn, cursor.id)));
}

/** Query `limit + 1` rows, then pass them here. */
export function toPage<T>(rows: T[], limit: number, cursorOf: (row: T) => Cursor): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(cursorOf(items[items.length - 1])) : null };
}
