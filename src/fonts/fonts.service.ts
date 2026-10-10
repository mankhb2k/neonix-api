import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ilike, isNull, ne, sql } from "drizzle-orm";
import { AuthzService } from "../authz/authz.service";
import { ApiError } from "../common/api-error";
import { isUniqueViolation } from "../common/pg-errors";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { assets, uploadSessions } from "../db/schema/assets";
import { projectFontFamilies, userFontFaces, userFontFamilies } from "../db/schema/fonts";
import { projects } from "../db/schema/projects";
import { formatFromFilename, mimeTypeForFontFormat, parseUserFont, type ParsedFontMetadata } from "./font-metadata";
import { R2Service } from "../r2/r2.service";

@Injectable()
export class FontsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authz: AuthzService,
    private readonly r2: R2Service,
  ) {}

  private async loadFamilyForMember(userId: string, familyId: string) {
    const family = await this.db.query.userFontFamilies.findFirst({ where: eq(userFontFamilies.id, familyId) });
    if (!family) return null;
    const isMember = await this.authz.hasWorkspaceRole(userId, family.workspaceId, "viewer");
    if (!isMember) return null;
    return family;
  }

  async listFamilies(userId: string, workspaceId: string) {
    const canView = await this.authz.hasWorkspaceRole(userId, workspaceId, "viewer");
    if (!canView) throw new ApiError(404, "Workspace not found");
    return this.db.query.userFontFamilies.findMany({ where: eq(userFontFamilies.workspaceId, workspaceId) });
  }

  async createFamily(userId: string, input: { workspaceId: string; slug: string; familyName: string }) {
    const canEdit = await this.authz.hasWorkspaceRole(userId, input.workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Workspace not found");
    try {
      const [family] = await this.db
        .insert(userFontFamilies)
        .values({ workspaceId: input.workspaceId, slug: input.slug, familyName: input.familyName.trim(), createdBy: userId })
        .returning();
      return family;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "A font family with that slug or name already exists in this workspace", "font_family_conflict");
      }
      throw error;
    }
  }

  async getFamily(userId: string, familyId: string) {
    const family = await this.loadFamilyForMember(userId, familyId);
    if (!family) throw new ApiError(404, "Font family not found");
    return family;
  }

  async deleteFamily(userId: string, familyId: string) {
    const family = await this.loadFamilyForMember(userId, familyId);
    if (!family) throw new ApiError(404, "Font family not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, family.workspaceId, "editor");
    if (!canEdit) throw new ApiError(403, "Editor role required");
    await this.db.delete(userFontFamilies).where(eq(userFontFamilies.id, family.id));
  }

  async listFaces(userId: string, familyId: string) {
    const family = await this.loadFamilyForMember(userId, familyId);
    if (!family) throw new ApiError(404, "Font family not found");
    return this.db.query.userFontFaces.findMany({ where: eq(userFontFaces.fontFamilyId, family.id) });
  }

  // Replaces `validate_user_font_asset()`: the asset must be a live, ready
  // `kind = 'font'` asset in the SAME workspace as the font family.
  async createFace(
    userId: string,
    familyId: string,
    input: { assetId: string; faceKey: string; weight: number; style: string; widthClass: string; format: string },
  ) {
    const family = await this.db.query.userFontFamilies.findFirst({ where: eq(userFontFamilies.id, familyId) });
    if (!family) throw new ApiError(404, "Font family not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, family.workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Font family not found");

    const asset = await this.db.query.assets.findFirst({ where: eq(assets.id, input.assetId) });
    if (!asset || asset.kind !== "font" || asset.status !== "ready" || asset.deletedAt || asset.workspaceId !== family.workspaceId) {
      throw new ApiError(422, "Asset must be a live, ready font asset in the same workspace as the font family", "invalid_font_asset");
    }

    try {
      return await this.db
        .insert(userFontFaces)
        .values({
          fontFamilyId: family.id,
          assetId: input.assetId,
          faceKey: input.faceKey,
          weight: input.weight,
          style: input.style,
          widthClass: input.widthClass,
          format: input.format,
        })
        .returning()
        .then(([face]) => face);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "A face with that key already exists on this family, or the asset is already used by another face", "font_face_conflict");
      }
      throw error;
    }
  }

  async deleteFace(userId: string, faceId: string) {
    const face = await this.db.query.userFontFaces.findFirst({ where: eq(userFontFaces.id, faceId) });
    if (!face) throw new ApiError(404, "Font face not found");
    const family = await this.db.query.userFontFamilies.findFirst({ where: eq(userFontFamilies.id, face.fontFamilyId) });
    const canEdit = family && (await this.authz.hasWorkspaceRole(userId, family.workspaceId, "editor"));
    if (!canEdit) throw new ApiError(404, "Font face not found");
    await this.db.delete(userFontFaces).where(eq(userFontFaces.id, face.id));
  }

  // Replaces `validate_project_user_font_family()`: the project and the
  // font family must belong to the same workspace.
  async createProjectLink(userId: string, input: { projectId: string; fontFamilyId: string; alias: string | null }) {
    const [project, family] = await Promise.all([
      this.db.query.projects.findFirst({ where: eq(projects.id, input.projectId) }),
      this.db.query.userFontFamilies.findFirst({ where: eq(userFontFamilies.id, input.fontFamilyId) }),
    ]);
    if (!project || !family || project.workspaceId !== family.workspaceId) {
      throw new ApiError(422, "Project and font family must belong to the same workspace", "workspace_mismatch");
    }
    const canEdit = await this.authz.hasWorkspaceRole(userId, project.workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Project not found");

    const [link] = await this.db
      .insert(projectFontFamilies)
      .values({ projectId: input.projectId, fontFamilyId: input.fontFamilyId, alias: input.alias, createdBy: userId })
      .onConflictDoNothing()
      .returning();
    return link ?? { projectId: input.projectId, fontFamilyId: input.fontFamilyId, alias: input.alias };
  }

  async listProjectLinks(userId: string, projectId: string) {
    const project = await this.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) throw new ApiError(404, "Project not found");
    const canView = await this.authz.hasWorkspaceRole(userId, project.workspaceId, "viewer");
    if (!canView) throw new ApiError(404, "Project not found");
    return this.db.query.projectFontFamilies.findMany({ where: eq(projectFontFamilies.projectId, projectId) });
  }

  async deleteProjectLink(userId: string, projectId: string, fontFamilyId: string) {
    const project = await this.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) throw new ApiError(404, "Project not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, project.workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Project not found");
    await this.db
      .delete(projectFontFamilies)
      .where(and(eq(projectFontFamilies.projectId, projectId), eq(projectFontFamilies.fontFamilyId, fontFamilyId)));
  }

  // Finishes a font upload created via AssetsService.createUploadRequest
  // (kind: "font"): downloads the just-uploaded bytes back from R2, parses
  // real font-binary metadata (weight/style/family via fontkit - never
  // trusts filename/caller-supplied metadata), dedupes by content hash,
  // and auto-creates-or-reuses the font family by name. This is a
  // materially different, richer contract than createFace() above (which
  // requires the caller to already know weight/style/format) - matches the
  // old apps/web one-shot upload UX exactly.
  async completeFontUpload(userId: string, assetId: string) {
    const asset = await this.db.query.assets.findFirst({ where: eq(assets.id, assetId) });
    if (!asset) throw new ApiError(404, "Font upload not found");
    const canEdit = await this.authz.hasWorkspaceRole(userId, asset.workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Font upload not found");
    if (asset.kind !== "font") throw new ApiError(409, "Asset is not a font upload");
    if (asset.status === "ready") throw new ApiError(409, "Font upload is already complete");
    if (asset.status !== "uploading") throw new ApiError(409, "Font is not uploadable");

    const head = await this.r2.headObject("R2_USER_ASSETS_BUCKET", asset.r2Key);
    if (!head) throw new ApiError(400, "The font has not finished uploading to R2");
    if (head.sizeBytes !== asset.byteSize) throw new ApiError(400, "Uploaded font size does not match the declared size");

    const fileName = asset.originalFilename ?? "";
    const format = formatFromFilename(fileName);
    if (!format) throw new ApiError(400, "Only static .ttf, .woff, and .woff2 files are supported");

    const buffer = await this.r2.getObject("R2_USER_ASSETS_BUCKET", asset.r2Key);
    if (!buffer) throw new ApiError(502, "Unable to read uploaded font");
    const contentHash = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;

    let metadata: ParsedFontMetadata;
    try {
      metadata = parseUserFont(buffer);
    } catch (error) {
      await this.discardFontUpload(asset.r2Key, assetId);
      throw new ApiError(400, error instanceof Error ? error.message : "Invalid font");
    }

    const sameHash = await this.db.query.assets.findFirst({
      where: and(
        eq(assets.workspaceId, asset.workspaceId),
        eq(assets.kind, "font"),
        eq(assets.contentHash, contentHash),
        isNull(assets.deletedAt),
        eq(assets.status, "ready"),
        ne(assets.id, assetId),
      ),
    });
    if (sameHash) return this.rejectDuplicateFontUpload(asset.r2Key, assetId, "This font file already exists (same content)");

    try {
      const created = await this.db.transaction(async (tx) => {
        let family = await tx.query.userFontFamilies.findFirst({
          where: and(eq(userFontFamilies.workspaceId, asset.workspaceId), ilike(userFontFamilies.familyName, metadata.familyName)),
        });
        if (!family) {
          const slug = `${metadata.familyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70)}-${assetId.slice(0, 8)}`;
          [family] = await tx
            .insert(userFontFamilies)
            .values({ workspaceId: asset.workspaceId, createdBy: userId, slug, familyName: metadata.familyName })
            .returning();
        }

        const sameFace = await tx.query.userFontFaces.findFirst({
          where: and(eq(userFontFaces.fontFamilyId, family!.id), eq(userFontFaces.faceKey, metadata.faceKey)),
        });
        if (sameFace) throw new ApiError(409, "A font with this family, weight, and style already exists", "font_face_conflict");

        await tx
          .update(assets)
          .set({
            status: "ready",
            contentHash,
            mimeType: mimeTypeForFontFormat(format),
            metadataJson: {
              familyName: metadata.familyName,
              subfamilyName: metadata.subfamilyName,
              weight: metadata.weight,
              style: metadata.style,
            },
          })
          .where(eq(assets.id, assetId));

        const [inserted] = await tx
          .insert(userFontFaces)
          .values({
            fontFamilyId: family!.id,
            assetId,
            faceKey: metadata.faceKey,
            version: metadata.version,
            weight: metadata.weight,
            style: metadata.style,
            widthClass: metadata.widthClass,
            format,
            subfamilyName: metadata.subfamilyName,
            postscriptName: metadata.postscriptName,
            axesJson: metadata.axes,
          })
          .returning();

        await tx
          .update(uploadSessions)
          .set({ status: "completed", completedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(uploadSessions.assetId, assetId));

        return { face: inserted!, family: family! };
      });

      return {
        id: `custom:${metadata.faceKey}:${assetId}`,
        source: "custom" as const,
        familyName: created.family.familyName,
        subfamilyName: metadata.subfamilyName,
        weight: metadata.weight,
        style: metadata.style,
        format,
        fontAssetId: `asset-${assetId}`,
        assetId,
        filename: fileName,
        byteSize: asset.byteSize,
        uri: `/v1/assets/${assetId}/media`,
        integrity: contentHash,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        return this.rejectDuplicateFontUpload(asset.r2Key, assetId, error.message, error.getStatus());
      }
      if (isUniqueViolation(error)) {
        return this.rejectDuplicateFontUpload(asset.r2Key, assetId, "A font family or face with that name already exists");
      }
      throw error;
    }
  }

  // On any rejection after the object already landed in R2 (parse failure,
  // content-hash duplicate, family/face-name conflict), scrap the whole
  // upload attempt rather than leaving an orphaned "uploading" asset row
  // behind - matches the old apps/web route's cleanup exactly.
  private async discardFontUpload(r2Key: string, assetId: string): Promise<void> {
    await this.r2.deleteObject("R2_USER_ASSETS_BUCKET", r2Key).catch(() => undefined);
    await this.db.delete(uploadSessions).where(eq(uploadSessions.assetId, assetId));
    await this.db.delete(assets).where(eq(assets.id, assetId));
  }

  private async rejectDuplicateFontUpload(r2Key: string, assetId: string, message: string, status = 409): Promise<never> {
    await this.discardFontUpload(r2Key, assetId);
    throw new ApiError(status, message, "font_upload_conflict");
  }
}
