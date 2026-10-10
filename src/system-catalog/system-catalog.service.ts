import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import { parseRangeRequest } from "../common/http-range";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { systemAssets, systemFontFamilies, systemFontFiles } from "../db/schema/system-catalog";
import { R2Service } from "../r2/r2.service";

// Font bytes are served publicly straight from R2
// by the separate fonts.neonix.video Cloudflare Worker - this API only
// proxies bytes for the authenticated per-file route and for system_assets
// (a handful of fallback placeholders with no dedicated CDN).

const USER_FONT_FORMATS = ["ttf", "woff", "woff2"] as const;
const PUBLIC_FONT_CDN = "https://fonts.neonix.video";
const SYSTEM_ASSET_VARIANTS = ["origin", "poster", "audio", "waveform", "thumbnail"] as const;
type SystemAssetVariant = (typeof SYSTEM_ASSET_VARIANTS)[number];

export interface PublicSystemFont {
  id: string;
  source: "system";
  familyName: string;
  subfamilyName: string;
  weight: number;
  style: string;
  format: string;
  fontAssetId: string;
  uri: string;
  integrity: string;
}

function integrity(value: string | null | undefined): string | null {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/i.test(value) ? value : null;
}

function publicFontUrl(r2Key: string): string {
  const path = r2Key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${PUBLIC_FONT_CDN}/${path}`;
}

function mimeTypeForFontFormat(format: string): string {
  return format === "woff2" ? "font/woff2" : format === "woff" ? "font/woff" : "font/ttf";
}

export function isSystemAssetVariant(value: unknown): value is SystemAssetVariant {
  return typeof value === "string" && (SYSTEM_ASSET_VARIANTS as readonly string[]).includes(value);
}

@Injectable()
export class SystemCatalogService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly r2: R2Service,
  ) {}

  async getPublicFontCatalog(): Promise<PublicSystemFont[]> {
    const [families, files] = await Promise.all([
      this.db.query.systemFontFamilies.findMany({
        where: and(eq(systemFontFamilies.enabled, true), eq(systemFontFamilies.source, "system")),
      }),
      this.db.query.systemFontFiles.findMany({ where: eq(systemFontFiles.enabled, true) }),
    ]);

    const familiesById = new Map(families.map((family) => [family.id, family]));
    const fonts = files.flatMap((file): PublicSystemFont[] => {
      if (!(USER_FONT_FORMATS as readonly string[]).includes(file.format)) return [];
      const family = familiesById.get(file.fontFamilyId);
      const hash = integrity(file.contentHash);
      if (!family || !hash) return [];
      return [{
        id: `system:${file.id}`,
        source: "system",
        familyName: family.familyName,
        subfamilyName: file.subfamilyName ?? "Regular",
        weight: file.weight,
        style: file.style,
        format: file.format,
        fontAssetId: `system-font-${file.id}`,
        uri: publicFontUrl(file.r2Key),
        integrity: hash,
      }];
    });

    fonts.sort((a, b) => a.familyName.localeCompare(b.familyName) || a.weight - b.weight || a.style.localeCompare(b.style));
    return fonts;
  }

  async streamFontFile(fontFileId: string): Promise<{ body: NodeJS.ReadableStream; contentType: string; contentLength: number }> {
    const file = await this.db.query.systemFontFiles.findFirst({
      where: and(eq(systemFontFiles.id, fontFileId), eq(systemFontFiles.enabled, true)),
    });
    if (!file) throw new ApiError(404, "System font not found");

    const bucketEnvVar = file.storageBucket === (process.env.R2_SYSTEM_FONTS_BUCKET?.trim() || "neonix-system-fonts")
      ? "R2_SYSTEM_FONTS_BUCKET"
      : "R2_SYSTEM_ASSETS_BUCKET";
    const head = await this.r2.headObject(bucketEnvVar, file.r2Key);
    if (!head) throw new ApiError(404, "System font object not found");
    const object = await this.r2.getObjectStream(bucketEnvVar, file.r2Key);
    if (!object) throw new ApiError(404, "System font body is empty");
    return {
      body: object.body,
      contentType: head.contentType ?? mimeTypeForFontFormat(file.format),
      contentLength: head.sizeBytes,
    };
  }

  async streamSystemAsset(
    systemAssetId: string,
    variant: SystemAssetVariant,
    range: string | undefined,
  ): Promise<
    | { outcome: "invalid-range"; totalSize: number }
    | { outcome: "ok"; body: NodeJS.ReadableStream; contentType: string; status: number; contentLength: number; contentRange?: string }
  > {
    const asset = variant === "origin"
      ? await this.db.query.systemAssets.findFirst({
          where: and(eq(systemAssets.id, systemAssetId), eq(systemAssets.variantKind, "origin"), eq(systemAssets.enabled, true)),
        })
      : await this.db.query.systemAssets.findFirst({
          where: and(eq(systemAssets.parentId, systemAssetId), eq(systemAssets.variantKind, variant), eq(systemAssets.enabled, true)),
        });
    if (!asset) throw new ApiError(404, "System asset not found");

    const head = await this.r2.headObject("R2_SYSTEM_ASSETS_BUCKET", asset.r2Key);
    if (!head) throw new ApiError(404, "System asset object not found");

    const parsedRange = parseRangeRequest(range, head.sizeBytes);
    if (parsedRange.outcome === "invalid") return { outcome: "invalid-range", totalSize: parsedRange.totalSize };

    const object = await this.r2.getObjectStream("R2_SYSTEM_ASSETS_BUCKET", asset.r2Key, parsedRange.requestedRange);
    if (!object) throw new ApiError(404, "System asset body is empty");
    return {
      outcome: "ok",
      body: object.body,
      contentType: head.contentType ?? asset.mimeType,
      status: parsedRange.status,
      contentLength: parsedRange.contentLength,
      contentRange: parsedRange.contentRange,
    };
  }
}
