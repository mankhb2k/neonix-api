// Shared HTTP Range (RFC 7233, single-range only - `bytes=start-end`) parser
// for byte-serving routes (system-fonts, system-assets, asset media). A
// missing `range` header, or `range` that fails to parse/is out of bounds,
// both produce a clear discriminated result instead of throwing, so the
// caller can render the correct 200/206/416 response.
export type RangeRequestResult =
  | { outcome: "none"; status: 200; contentLength: number; requestedRange?: undefined; contentRange?: undefined }
  | { outcome: "ok"; status: 206; contentLength: number; requestedRange: string; contentRange: string }
  | { outcome: "invalid"; totalSize: number };

export function parseRangeRequest(range: string | undefined, totalSize: number): RangeRequestResult {
  if (!range) return { outcome: "none", status: 200, contentLength: totalSize };

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match) return { outcome: "invalid", totalSize };

  const start = match[1] ? Number(match[1]) : Math.max(0, totalSize - Number(match[2] || 0));
  const end = match[2] ? Number(match[2]) : totalSize - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= totalSize) {
    return { outcome: "invalid", totalSize };
  }

  const boundedEnd = Math.min(end, totalSize - 1);
  return {
    outcome: "ok",
    status: 206,
    contentLength: boundedEnd - start + 1,
    requestedRange: `bytes=${start}-${boundedEnd}`,
    contentRange: `bytes ${start}-${boundedEnd}/${totalSize}`,
  };
}
