import type { templates, templateVersions } from "../db/schema/templates";

export type ReviewDecision = { kind: "approve" } | { kind: "reject"; reason: string } | { kind: "manual" };

// Deliberately permissive for now: the upload is already checked (exists, size,
// sha256, preview present) before a version can be submitted, so everything
// passes. Tighten HERE later (content checks, `manual` to queue it for an
// admin via /v1/admin/template-versions) - nothing else needs to change.
export function reviewPolicy(
  _template: typeof templates.$inferSelect,
  _version: typeof templateVersions.$inferSelect,
): ReviewDecision {
  return { kind: "approve" };
}
