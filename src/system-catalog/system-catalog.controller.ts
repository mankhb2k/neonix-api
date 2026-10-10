import { Controller, Get, Header, Options, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { isSystemAssetVariant, SystemCatalogService } from "./system-catalog.service";

const PUBLIC_CATALOG_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
};

@Controller()
export class SystemCatalogController {
  constructor(private readonly catalog: SystemCatalogService) {}

  // Unauthenticated: font bytes are served publicly by the fonts.neonix.video
  // CDN regardless, so the catalog listing them is public too.
  @Options("v1/system-fonts")
  optionsPublicCatalog(@Res() res: Response) {
    res.status(204).set(PUBLIC_CATALOG_HEADERS).end();
  }

  @Get("v1/system-fonts")
  @Header("Access-Control-Allow-Origin", "*")
  @Header("Access-Control-Allow-Methods", "GET, OPTIONS")
  @Header("Access-Control-Allow-Headers", "Accept, Content-Type")
  @Header("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400")
  async getPublicFontCatalog() {
    return { scope: "public", fonts: await this.catalog.getPublicFontCatalog() };
  }

  @UseGuards(CurrentUserGuard)
  @Get("v1/system-fonts/:fontFileId")
  async streamFontFile(@Param("fontFileId") fontFileId: string, @Res() res: Response) {
    const file = await this.catalog.streamFontFile(fontFileId);
    res.set({
      "Content-Type": file.contentType,
      "Content-Length": String(file.contentLength),
      "Cache-Control": "private, max-age=3600",
    });
    file.body.pipe(res);
  }

  @UseGuards(CurrentUserGuard)
  @Get("v1/system-assets/:systemAssetId")
  async streamSystemAsset(
    @Param("systemAssetId") systemAssetId: string,
    @Query("variant") variantParam: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const variant = isSystemAssetVariant(variantParam) ? variantParam : "origin";
    const result = await this.catalog.streamSystemAsset(systemAssetId, variant, req.headers.range);
    if (result.outcome === "invalid-range") {
      res.set("Content-Range", `bytes */${result.totalSize}`);
      res.status(416).end();
      return;
    }
    res.status(result.status).set({
      "Content-Type": result.contentType,
      "Content-Length": String(result.contentLength),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      ...(result.contentRange ? { "Content-Range": result.contentRange } : {}),
    });
    result.body.pipe(res);
  }
}
