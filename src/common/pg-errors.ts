// drizzle-orm 0.45.x wraps the real `pg` driver error and exposes it via
// `.cause`, not directly as `.code` on the thrown error - checking
// `error.code` alone silently never matches, and it typechecks fine either
// way (the error is `unknown`), so this only shows up when the constraint
// is actually violated at runtime. Check both shapes to be safe against a
// future drizzle-orm version that stops wrapping.
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: { code?: unknown } }).cause;
  if (cause && typeof cause.code === "string") return cause.code;
  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === "23505";
}
