import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, max } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import { afterCursor, msTrunc, toPage, type Cursor } from "../common/pagination";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { profiles } from "../db/schema/profile";
import { templatePurchases, templateVersions, templates } from "../db/schema/templates";
import { env } from "../env";
import { creatorPrefix, imageExtension, previewKey, R2Service, templatePackageKey } from "../r2/r2.service";
import { reviewPolicy } from "./review-policy";

export type PackageSummary = { slotCount: number; width: number; height: number; durationMs: number };

export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;

type TemplateRow = typeof templates.$inferSelect;
type VersionRow = typeof templateVersions.$inferSelect;

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly r2: R2Service,
  ) {}

  private view(row: TemplateRow, creator?: { name: string | null; avatarKey: string | null }, version?: VersionRow | null, owned?: boolean) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      creditCost: row.creditCost,
      status: row.status,
      posterUrl: this.r2.publicUrl("previews", row.posterKey),
      previewUrl: this.r2.publicUrl("previews", row.previewKey),
      useCount: row.useCount,
      creator: { id: row.creatorId, name: creator?.name ?? null, avatarUrl: this.r2.publicUrl("avatars", creator?.avatarKey ?? null) },
      updatedAt: row.updatedAt,
      ...(version ? { version: this.versionView(version) } : {}),
      // Only in the catalogue (it depends on who is asking): true = already bought, exports are free.
      ...(owned === undefined ? {} : { owned }),
    };
  }

  private versionView(version: VersionRow) {
    return {
      version: version.version,
      sizeBytes: version.sizeBytes,
      formatVersion: version.formatVersion,
      minAppVersion: version.minAppVersion,
      slotCount: version.slotCount,
      width: version.width,
      height: version.height,
      durationMs: version.durationMs,
    };
  }

  // ---- public catalogue ----

  async list(userId: string | undefined, opts: { category?: string; q?: string; limit: number; cursor?: Cursor }) {
    const rows = await this.db
      .select({ template: templates, creator: { name: profiles.displayName, avatarKey: profiles.avatarKey }, version: templateVersions, purchaseId: templatePurchases.id })
      .from(templates)
      .leftJoin(profiles, eq(profiles.id, templates.creatorId))
      .leftJoin(templatePurchases, and(eq(templatePurchases.templateId, templates.id), eq(templatePurchases.userId, userId ?? "")))
      .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
      .where(
        and(
          eq(templates.status, "published"),
          opts.category ? eq(templates.category, opts.category) : undefined,
          opts.q ? ilike(templates.title, `%${opts.q.replace(/[%_]/g, "\\$&")}%`) : undefined,
          afterCursor(templates.updatedAt, templates.id, opts.cursor),
        ),
      )
      .orderBy(desc(msTrunc(templates.updatedAt)), desc(templates.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ t: r.template.updatedAt.toISOString(), id: r.template.id }));
    return { items: page.items.map((r) => this.view(r.template, r.creator ?? undefined, r.version, userId ? r.purchaseId !== null : undefined)), nextCursor: page.nextCursor };
  }

  async getPublished(userId: string | undefined, id: string) {
    const [row] = await this.db
      .select({ template: templates, creator: { name: profiles.displayName, avatarKey: profiles.avatarKey }, purchaseId: templatePurchases.id })
      .from(templates)
      .leftJoin(profiles, eq(profiles.id, templates.creatorId))
      .leftJoin(templatePurchases, and(eq(templatePurchases.templateId, templates.id), eq(templatePurchases.userId, userId ?? "")))
      .where(and(eq(templates.id, id), eq(templates.status, "published")));
    if (!row || !row.template.currentVersionId) throw new ApiError(404, "Template not found");
    const version = await this.db.query.templateVersions.findFirst({
      where: eq(templateVersions.id, row.template.currentVersionId),
    });
    return this.view(row.template, row.creator ?? undefined, version, userId ? row.purchaseId !== null : undefined);
  }

  /**
   * Package download for editing: any signed-in user, no credits. Credits are spent at
   * the first export of a template (ExportsService.create). `versionId` lets a project keep using the version
   * it was started from; default is the current approved one.
   */
  async getPackage(id: string, versionId?: string) {
    const template = await this.db.query.templates.findFirst({ where: eq(templates.id, id) });
    if (!template || template.status !== "published" || !template.currentVersionId) throw new ApiError(404, "Template not found");
    const version = await this.db.query.templateVersions.findFirst({
      where: and(eq(templateVersions.id, versionId ?? template.currentVersionId), eq(templateVersions.templateId, id), eq(templateVersions.status, "approved")),
    });
    if (!version) throw new ApiError(404, "Version not found");
    const download = await this.r2.presignGet("templates", version.packageKey);
    return { url: download.url, expiresAt: download.expiresAt, versionId: version.id, sha256: version.sha256, ...this.versionView(version) };
  }

  // ---- creator ----

  async listMine(creatorId: string) {
    const rows = await this.db.select().from(templates).where(eq(templates.creatorId, creatorId)).orderBy(desc(templates.updatedAt));
    return { items: rows.map((r) => this.view(r)) };
  }

  // Price and creator earning are admin-only; new templates start at the env defaults.
  async create(creatorId: string, input: { title: string; description?: string; category?: string }) {
    const [row] = await this.db
      .insert(templates)
      .values({ creatorId, ...input, creditCost: env.defaultExportCredits, creatorEarningVnd: env.defaultCreatorEarningVnd })
      .returning();
    return this.view(row);
  }

  private async ownTemplate(creatorId: string, id: string): Promise<TemplateRow> {
    const row = await this.db.query.templates.findFirst({ where: and(eq(templates.id, id), eq(templates.creatorId, creatorId)) });
    if (!row) throw new ApiError(404, "Template not found");
    return row;
  }

  async update(
    creatorId: string,
    id: string,
    patch: { title?: string; description?: string; category?: string; posterKey?: string; previewKey?: string; unlisted?: boolean },
  ) {
    const current = await this.ownTemplate(creatorId, id);
    for (const key of [patch.posterKey, patch.previewKey]) {
      if (key !== undefined && !key.startsWith(creatorPrefix(creatorId, id))) throw new ApiError(400, "Invalid preview key", "INVALID_KEY");
    }
    const { unlisted, ...fields } = patch;
    const status = unlisted === undefined ? undefined : unlisted ? "unlisted" : current.currentVersionId ? "published" : "draft";
    const [row] = await this.db
      .update(templates)
      .set({ ...fields, ...(status ? { status } : {}), updatedAt: new Date() })
      .where(eq(templates.id, id))
      .returning();
    return this.view(row);
  }

  /** `kind: "poster"` = still image (cards, viewer first frame); `"preview"` = short looping video or image. */
  async createPreviewUpload(creatorId: string, id: string, contentType: string, kind: "poster" | "preview" = "preview") {
    await this.ownTemplate(creatorId, id);
    const ext = imageExtension(contentType);
    if (!ext || (kind === "poster" && contentType === "video/mp4")) {
      throw new ApiError(400, kind === "poster" ? "Poster must be png, jpeg or webp" : "Preview must be png, jpeg, webp or mp4", "UNSUPPORTED_TYPE");
    }
    const key = previewKey(creatorId, id, ext);
    return { key, upload: await this.r2.presignPut("previews", key, contentType) };
  }

  /** New version row + presigned PUT for its zip. */
  async createVersion(creatorId: string, id: string, input: { formatVersion?: number; minAppVersion?: string }) {
    await this.ownTemplate(creatorId, id);
    const [{ latest }] = await this.db
      .select({ latest: max(templateVersions.version) })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, id));
    const version = (latest ?? 0) + 1;
    const key = templatePackageKey(creatorId, id, version);
    const [row] = await this.db
      .insert(templateVersions)
      .values({ templateId: id, version, packageKey: key, ...input })
      .returning();
    return { versionId: row.id, version, upload: await this.r2.presignPut("templates", key, "application/zip", 1800) };
  }

  private async ownVersion(creatorId: string, id: string, version: number) {
    await this.ownTemplate(creatorId, id);
    const row = await this.db.query.templateVersions.findFirst({
      where: and(eq(templateVersions.templateId, id), eq(templateVersions.version, version)),
    });
    if (!row) throw new ApiError(404, "Version not found");
    return row;
  }

  /** Creator says the PUT finished; we check the object really exists and fits. */
  async completeUpload(creatorId: string, id: string, version: number, sha256: string, summary: PackageSummary) {
    const row = await this.ownVersion(creatorId, id, version);
    if (row.status !== "pending_upload") throw new ApiError(409, "Version already uploaded", "ALREADY_UPLOADED");
    const head = await this.r2.headObject("templates", row.packageKey);
    if (!head) throw new ApiError(400, "Package was not uploaded", "NOT_UPLOADED");
    if (head.sizeBytes <= 0 || head.sizeBytes > MAX_PACKAGE_BYTES) {
      await this.r2.deleteObject("templates", row.packageKey);
      throw new ApiError(400, `Package must be 1 B – ${MAX_PACKAGE_BYTES} B`, "BAD_SIZE");
    }
    await this.db
      .update(templateVersions)
      .set({ status: "uploaded", sizeBytes: head.sizeBytes, sha256: sha256.toLowerCase(), ...summary })
      .where(eq(templateVersions.id, row.id));
    return { version, sizeBytes: head.sizeBytes };
  }

  async submitForReview(creatorId: string, id: string, version: number) {
    const template = await this.ownTemplate(creatorId, id);
    const row = await this.ownVersion(creatorId, id, version);
    if (row.status !== "uploaded" && row.status !== "rejected") throw new ApiError(409, "Version is not ready for review", "BAD_STATE");
    if (!template.posterKey) throw new ApiError(400, "Upload a poster first", "POSTER_REQUIRED");
    await this.db.update(templateVersions).set({ status: "in_review", rejectionReason: null }).where(eq(templateVersions.id, row.id));

    const decision = reviewPolicy(template, row);
    if (decision.kind === "approve") await this.review(row.id, { approve: true });
    else if (decision.kind === "reject") await this.review(row.id, { approve: false, reason: decision.reason });
    const after = await this.db.query.templateVersions.findFirst({ where: eq(templateVersions.id, row.id) });
    return { version, status: after?.status ?? "in_review" };
  }

  // ---- admin review ----

  async listInReview() {
    const rows = await this.db
      .select({ version: templateVersions, template: templates })
      .from(templateVersions)
      .innerJoin(templates, eq(templates.id, templateVersions.templateId))
      .where(eq(templateVersions.status, "in_review"))
      .orderBy(templateVersions.createdAt);
    return { items: rows.map((r) => ({ template: this.view(r.template), version: r.version.version, versionId: r.version.id, sizeBytes: r.version.sizeBytes })) };
  }

  async review(versionId: string, decision: { approve: true } | { approve: false; reason: string }) {
    return this.db.transaction(async (tx) => {
      const [version] = await tx.select().from(templateVersions).where(eq(templateVersions.id, versionId)).for("update");
      if (!version || version.status !== "in_review") throw new ApiError(409, "Version is not in review", "BAD_STATE");
      if (!decision.approve) {
        await tx.update(templateVersions).set({ status: "rejected", rejectionReason: decision.reason }).where(eq(templateVersions.id, versionId));
        return { status: "rejected" as const };
      }
      await tx.update(templateVersions).set({ status: "approved" }).where(eq(templateVersions.id, versionId));
      await tx
        .update(templates)
        .set({ currentVersionId: versionId, status: "published", updatedAt: new Date() })
        .where(eq(templates.id, version.templateId));
      return { status: "approved" as const };
    });
  }

  /** Admin-only: price, creator earning per export, and takedown/relist. */
  async adminUpdate(id: string, patch: { creditCost?: number; creatorEarningVnd?: number; status?: "published" | "unlisted" }) {
    const [row] = await this.db
      .update(templates)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(templates.id, id))
      .returning();
    if (!row) throw new ApiError(404, "Template not found");
    return this.view(row);
  }
}
