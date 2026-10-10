import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { AuthzService } from "../authz/authz.service";
import { ApiError } from "../common/api-error";
import { parseRangeRequest } from "../common/http-range";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { assets, assetVariants, projectAssets, uploadSessions } from "../db/schema/assets";
import { projects } from "../db/schema/projects";
import { QuotasService } from "../quotas/quotas.service";
import { defaultObjectKey, R2Service } from "../r2/r2.service";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const MEDIA_VARIANTS = ["original", "poster", "audio"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

export function isMediaVariant(value: unknown): value is MediaVariant {
  return typeof value === "string" && (MEDIA_VARIANTS as readonly string[]).includes(value);
}

@Injectable()
export class AssetsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authz: AuthzService,
    private readonly quotas: QuotasService,
    private readonly r2: R2Service,
  ) {}

  // Replaces `enforce_asset_account_quota()`: per-file ceiling first, then
  // the pooled workspace/team storage quota - same order and same two
  // distinct rejection reasons as the original trigger.
  async createUploadRequest(
    userId: string,
    input: { workspaceId: string; mimeType: string; byteSize: number; kind: string; originalFilename: string | null },
  ) {
    const canEdit = await this.authz.hasWorkspaceRole(userId, input.workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Workspace not found");

    const workspace = await this.quotas.getWorkspaceOrThrow(input.workspaceId);
    const { storageQuotaBytes, maxUploadBytes } = await this.quotas.getStorageLimits(workspace);
    if (input.byteSize > maxUploadBytes) {
      throw new ApiError(413, `File exceeds the plan's ${maxUploadBytes}-byte per-file limit`, "upload_too_large");
    }
    const used = await this.quotas.getWorkspaceStorageUsedBytes(input.workspaceId);
    if (used + input.byteSize > storageQuotaBytes) {
      throw new ApiError(409, "Workspace storage quota would be exceeded", "storage_quota_exceeded");
    }

    const assetId = randomUUID();
    const r2Key = defaultObjectKey(input.workspaceId, assetId, input.mimeType);

    const [asset] = await this.db
      .insert(assets)
      .values({
        id: assetId,
        workspaceId: input.workspaceId,
        r2Key,
        contentHash: `pending:${assetId}`,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        createdBy: userId,
        kind: input.kind,
        status: "uploading",
        originalFilename: input.originalFilename,
      })
      .returning();

    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
    await this.db.insert(uploadSessions).values({
      workspaceId: input.workspaceId,
      assetId,
      createdBy: userId,
      expiresAt,
      expectedByteSize: input.byteSize,
      expectedMimeType: input.mimeType,
    });

    const presigned = await this.r2.presignPut("R2_USER_ASSETS_BUCKET", r2Key, input.mimeType, UPLOAD_URL_TTL_SECONDS);
    return { asset, uploadUrl: presigned.url, headers: presigned.headers, expiresAt: presigned.expiresAt };
  }

  // Replaces the media-ingest flow's "complete" step (minus the
  // media-preparer callback, a separate Cloud Run service, out of scope
  // here): checks the object really landed in R2 before flipping the asset
  // to `ready`.
  async completeUpload(userId: string, assetId: string, contentHashOverride?: string) {
    const asset = await this.db.query.assets.findFirst({ where: eq(assets.id, assetId) });
    if (!asset) throw new ApiError(404, "Asset not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, asset.workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Asset not found");
    if (asset.status !== "uploading") {
      throw new ApiError(409, `Asset is not awaiting upload (status: ${asset.status})`);
    }

    const head = await this.r2.headObject("R2_USER_ASSETS_BUCKET", asset.r2Key);
    if (!head) throw new ApiError(422, "No object found at the asset's R2 key", "upload_not_found");

    const contentHash = contentHashOverride ?? `unverified:${head.sizeBytes}`;
    const [updated] = await this.db
      .update(assets)
      .set({ status: "ready", byteSize: head.sizeBytes, contentHash })
      .where(eq(assets.id, asset.id))
      .returning();

    await this.db
      .update(uploadSessions)
      .set({ status: "completed", completedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(uploadSessions.assetId, asset.id));

    return updated;
  }

  async list(userId: string, workspaceId: string) {
    const canView = await this.authz.hasWorkspaceRole(userId, workspaceId, "viewer");
    if (!canView) throw new ApiError(404, "Workspace not found");
    return this.db.query.assets.findMany({
      where: and(eq(assets.workspaceId, workspaceId), isNull(assets.deletedAt)),
      orderBy: desc(assets.createdAt),
    });
  }

  async getForMember(userId: string, assetId: string) {
    const asset = await this.db.query.assets.findFirst({ where: eq(assets.id, assetId) });
    if (!asset || asset.deletedAt) throw new ApiError(404, "Asset not found");
    const canView = await this.authz.hasWorkspaceRole(userId, asset.workspaceId, "viewer");
    if (!canView) throw new ApiError(404, "Asset not found");
    return asset;
  }

  // Which non-deleted projects (in the asset's own workspace) currently
  // reference this asset via `project_assets`.
  async getUsage(userId: string, assetId: string) {
    const asset = await this.getForMember(userId, assetId);
    const links = await this.db.query.projectAssets.findMany({ where: eq(projectAssets.assetId, asset.id) });
    if (links.length === 0) return { assetId: asset.id, projects: [] };

    const projectIds = [...new Set(links.map((link) => link.projectId))];
    const rows = await this.db.query.projects.findMany({
      where: and(inArray(projects.id, projectIds), isNull(projects.deletedAt)),
      orderBy: projects.title,
    });
    return {
      assetId: asset.id,
      projects: rows.map((project) => ({ id: project.id, title: project.title, publicRef: project.publicRef })),
    };
  }

  // Streams the asset's real bytes (not just metadata) - `original` is the
  // asset's own uploaded file; `poster`/`audio` are derivatives that only
  // exist once the media processing pipeline (not ported yet, see project
  // memory) has actually populated `assets.previewKey`/`asset_variants` for
  // it, so those variants 404 with a clear reason until then rather than
  // fabricating a placeholder. HTTP Range is supported for partial
  // video/audio playback, same as system-assets/system-fonts.
  async streamMedia(
    userId: string,
    assetId: string,
    variant: MediaVariant,
    range: string | undefined,
  ): Promise<
    | { outcome: "invalid-range"; totalSize: number }
    | { outcome: "ok"; body: NodeJS.ReadableStream; contentType: string; status: number; contentLength: number; contentRange?: string }
  > {
    const asset = await this.getForMember(userId, assetId);
    if (asset.status !== "ready") throw new ApiError(404, "Asset not found");

    let key: string;
    let fallbackMimeType: string;
    if (variant === "original") {
      key = asset.r2Key;
      fallbackMimeType = asset.mimeType;
    } else if (variant === "poster") {
      if (!asset.previewKey) throw new ApiError(404, "Poster is not ready");
      key = asset.previewKey;
      fallbackMimeType = "image/webp";
    } else {
      const audio = await this.db.query.assetVariants.findFirst({
        where: and(eq(assetVariants.assetId, asset.id), eq(assetVariants.variantKind, "audio")),
      });
      if (!audio) throw new ApiError(404, "Audio derivative is not ready");
      key = audio.r2Key;
      fallbackMimeType = audio.mimeType;
    }

    const head = await this.r2.headObject("R2_USER_ASSETS_BUCKET", key);
    if (!head) throw new ApiError(404, "Asset object not found");

    const parsedRange = parseRangeRequest(range, head.sizeBytes);
    if (parsedRange.outcome === "invalid") return { outcome: "invalid-range", totalSize: parsedRange.totalSize };

    const object = await this.r2.getObjectStream("R2_USER_ASSETS_BUCKET", key, parsedRange.requestedRange);
    if (!object) throw new ApiError(404, "Asset body is empty");
    return {
      outcome: "ok",
      body: object.body,
      contentType: head.contentType ?? fallbackMimeType,
      status: parsedRange.status,
      contentLength: parsedRange.contentLength,
      contentRange: parsedRange.contentRange,
    };
  }

  // NOTE: the original `delete_asset_with_system_fallback` also rewrites
  // every project document that references this asset to point at a
  // system placeholder instead, in the same transaction. That JSON-
  // document-rewrite business logic is not ported yet (TODO, Phase 3
  // follow-up) - this only soft-deletes the asset row itself.
  async softDelete(userId: string, assetId: string) {
    const asset = await this.db.query.assets.findFirst({ where: eq(assets.id, assetId) });
    if (!asset || asset.deletedAt) throw new ApiError(404, "Asset not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, asset.workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Asset not found");
    const [updated] = await this.db
      .update(assets)
      .set({ deletedAt: sql`now()`, status: "deleted" })
      .where(eq(assets.id, asset.id))
      .returning();
    return updated;
  }
}
