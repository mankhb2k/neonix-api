const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00 Vietnam time (UTC+7) of the week containing `now`, as a UTC instant. */
export function startOfVietnamWeek(now: Date): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const daysSinceMonday = (vn.getUTCDay() + 6) % 7;
  const mondayVn = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() - daysSinceMonday);
  return new Date(mondayVn - VN_OFFSET_MS);
}

/** The last fully finished Mon–Sun week (Vietnam time): [start, end). */
export function lastFullWeek(now: Date): { start: Date; end: Date } {
  const end = startOfVietnamWeek(now);
  return { start: new Date(end.getTime() - 7 * DAY_MS), end };
}
