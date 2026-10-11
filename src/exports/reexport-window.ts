// After a paid export, the same user may export the same project again for free for this long.
// Re-exports are not new exports: no charge, no creator earning, no use_count.
export const REEXPORT_WINDOW_MS = 30 * 60 * 1000;
/** Guard against a project id being reused to export an unbounded number of videos for one payment. */
export const MAX_FREE_REEXPORTS = 10;

export function reexportWindowEnd(paidAt: Date): Date {
  return new Date(paidAt.getTime() + REEXPORT_WINDOW_MS);
}

export function isWithinReexportWindow(paidAt: Date, now = new Date()): boolean {
  return now.getTime() < reexportWindowEnd(paidAt).getTime();
}
