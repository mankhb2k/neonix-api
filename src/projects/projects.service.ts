import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { AuthzService } from "../authz/authz.service";
import { ApiError } from "../common/api-error";
import { isUniqueViolation } from "../common/pg-errors";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { assets, projectAssets } from "../db/schema/assets";
import { projectHtmlDocuments, projects } from "../db/schema/projects";
import { QuotasService } from "../quotas/quotas.service";
import { validateRawHtmlDocument } from "./validate-raw-html";

function contentHashOf(documentJson: unknown): string {
  return createHash("sha256").update(JSON.stringify(documentJson)).digest("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function extractHtmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const decoded = match[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return decoded || null;
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authz: AuthzService,
    private readonly quotas: QuotasService,
  ) {}

  private async loadForMember(userId: string, projectId: string) {
    const project = await this.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) return null;
    const isMember = await this.authz.hasWorkspaceRole(userId, project.workspaceId, "viewer");
    if (!isMember) return null;
    return project;
  }

  async list(userId: string, workspaceId: string) {
    const canView = await this.authz.hasWorkspaceRole(userId, workspaceId, "viewer");
    if (!canView) throw new ApiError(404, "Workspace not found");
    return this.db.query.projects.findMany({
      where: and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)),
      orderBy: desc(projects.updatedAt),
    });
  }

  async getForMember(userId: string, projectId: string) {
    const project = await this.loadForMember(userId, projectId);
    if (!project || project.deletedAt) throw new ApiError(404, "Project not found");
    return project;
  }

  // Replaces `touch_project_activity()` (BEFORE UPDATE trigger): bumps
  // last_activity_at only when title changes - title is the only field this
  // route can change, so it always bumps it.
  async update(userId: string, projectId: string, title: string) {
    const project = await this.loadForMember(userId, projectId);
    if (!project || project.deletedAt) throw new ApiError(404, "Project not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, project.workspaceId, "editor");
    if (!canEdit) throw new ApiError(403, "Editor role required");

    const [updated] = await this.db
      .update(projects)
      .set({ title, updatedAt: sql`now()`, lastActivityAt: sql`now()` })
      .where(eq(projects.id, project.id))
      .returning();
    return updated;
  }

  // Replaces `request_project_deletion(project_id)`: soft-delete with a
  // 7-day purge window, matching `projects_lifecycle_check`'s invariant
  // that deleted_at and purge_after are always set together.
  async softDelete(userId: string, projectId: string) {
    const project = await this.loadForMember(userId, projectId);
    if (!project || project.deletedAt) throw new ApiError(404, "Project not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, project.workspaceId, "editor");
    if (!canEdit) throw new ApiError(403, "Editor role required");

    const [updated] = await this.db
      .update(projects)
      .set({
        deletedAt: sql`now()`,
        purgeAfter: sql`now() + interval '7 days'`,
        deletedBy: userId,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, project.id))
      .returning();
    return updated;
  }

  // Replaces `restore_project(project_id)`: undo within the purge window.
  async restore(userId: string, projectId: string) {
    const project = await this.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) throw new ApiError(404, "Project not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, project.workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Project not found");
    if (!project.deletedAt) throw new ApiError(409, "Project is not deleted");
    if (project.purgeAfter && project.purgeAfter.getTime() < Date.now()) {
      throw new ApiError(410, "Project's restore window has expired");
    }
    const [updated] = await this.db
      .update(projects)
      .set({ deletedAt: null, purgeAfter: null, deletedBy: null, updatedAt: sql`now()` })
      .where(eq(projects.id, project.id))
      .returning();
    return updated;
  }

  async attachAsset(userId: string, projectId: string, assetId: string) {
    const project = await this.loadForMember(userId, projectId);
    if (!project || project.deletedAt) throw new ApiError(404, "Project not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, project.workspaceId, "editor");
    if (!canEdit) throw new ApiError(403, "Editor role required");

    const asset = await this.db.query.assets.findFirst({
      where: and(eq(assets.id, assetId), eq(assets.workspaceId, project.workspaceId), isNull(assets.deletedAt)),
    });
    if (!asset) throw new ApiError(404, "Asset not found");

    await this.db
      .insert(projectAssets)
      .values({ projectId: project.id, assetId: asset.id, attachedBy: userId })
      .onConflictDoNothing();
  }

  // ── HTML projects ────────────────────────────────────────────────────
  // The HTML is stored as-is: no revision history and no compile step.

  private async checkActiveProjectLimit(workspaceId: string) {
    const workspace = await this.quotas.getWorkspaceOrThrow(workspaceId);
    const limit = await this.quotas.getActiveProjectLimit(workspace);
    const count = await this.db.$count(projects, and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)));
    if (count >= limit) {
      throw new ApiError(409, `Workspace is at its plan limit of ${limit} active projects`, "project_limit_reached");
    }
  }

  async createHtmlProject(
    userId: string,
    input: { workspaceId: string; title?: string; html: string; idempotencyKey?: string },
  ) {
    if (!input.html.trim()) throw new ApiError(422, "html is required", "invalid_html");
    const validationErrors = validateRawHtmlDocument(input.html);
    if (validationErrors.length > 0) {
      throw new ApiError(422, validationErrors[0]!.message, validationErrors[0]!.code);
    }

    const canEdit = await this.authz.hasWorkspaceRole(userId, input.workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Workspace not found");

    const idempotencyKey = input.idempotencyKey?.trim() || null;
    const idempotencyHash = idempotencyKey ? contentHashOf({ title: input.title, html: input.html }) : null;
    if (idempotencyKey) {
      const existing = await this.db.query.projects.findFirst({
        where: and(
          eq(projects.workspaceId, input.workspaceId),
          eq(projects.createIdempotencyKey, idempotencyKey),
          isNull(projects.deletedAt),
        ),
      });
      if (existing) {
        if (existing.createIdempotencyHash && existing.createIdempotencyHash !== idempotencyHash) {
          throw new ApiError(409, "Idempotency key was already used with a different payload", "idempotency_conflict");
        }
        return { project: existing, alreadyCreated: true };
      }
    }

    await this.checkActiveProjectLimit(input.workspaceId);
    const title = input.title?.trim() || extractHtmlTitle(input.html) || "Untitled project";

    try {
      return await this.db.transaction(async (tx) => {
        const [project] = await tx
          .insert(projects)
          .values({
            workspaceId: input.workspaceId,
            title,
            createdBy: userId,
            ...(idempotencyKey ? { createIdempotencyKey: idempotencyKey, createIdempotencyHash: idempotencyHash } : {}),
          })
          .returning();

        await tx.insert(projectHtmlDocuments).values({
          projectId: project!.id,
          html: input.html,
          contentHash: sha256Hex(input.html),
          byteSize: Buffer.byteLength(input.html, "utf8"),
          createdBy: userId,
        });

        return { project: project!, alreadyCreated: false };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "Idempotency key was already used with a different payload", "idempotency_conflict");
      }
      throw error;
    }
  }

  async getHtmlDocument(userId: string, projectId: string) {
    const project = await this.loadForMember(userId, projectId);
    if (!project || project.deletedAt) throw new ApiError(404, "Project not found");
    const document = await this.db.query.projectHtmlDocuments.findFirst({
      where: eq(projectHtmlDocuments.projectId, project.id),
    });
    if (!document) throw new ApiError(404, "HTML document not found");
    return { project, html: document.html, updatedAt: document.updatedAt };
  }

  // Overwrites the project's single HTML document in place - no revision
  // history, no optimistic-concurrency check (last write wins).
  async updateHtmlDocument(userId: string, projectId: string, html: string) {
    const project = await this.loadForMember(userId, projectId);
    if (!project || project.deletedAt) throw new ApiError(404, "Project not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, project.workspaceId, "editor");
    if (!canEdit) throw new ApiError(403, "Editor role required");
    if (!html.trim()) throw new ApiError(422, "html is required", "invalid_html");
    const validationErrors = validateRawHtmlDocument(html);
    if (validationErrors.length > 0) {
      throw new ApiError(422, validationErrors[0]!.message, validationErrors[0]!.code);
    }

    const [updated] = await this.db
      .update(projectHtmlDocuments)
      .set({ html, contentHash: sha256Hex(html), byteSize: Buffer.byteLength(html, "utf8"), updatedAt: sql`now()` })
      .where(eq(projectHtmlDocuments.projectId, project.id))
      .returning();
    if (!updated) throw new ApiError(404, "HTML document not found");

    await this.db
      .update(projects)
      .set({ lastActivityAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(projects.id, project.id));

    return { project, html: updated.html, updatedAt: updated.updatedAt };
  }
}
