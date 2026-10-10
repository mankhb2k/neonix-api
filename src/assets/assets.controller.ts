import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ApiError } from "../common/api-error";
import { AssetsService, isMediaVariant } from "./assets.service";
import { CompleteUploadDto } from "./dto/complete-upload.dto";
import { CreateUploadRequestDto } from "./dto/create-upload-request.dto";

@UseGuards(CurrentUserGuard)
@Controller("v1/assets")
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post("upload-requests")
  async createUploadRequest(@CurrentUser() userId: string, @Body() dto: CreateUploadRequestDto) {
    return this.assets.createUploadRequest(userId, {
      workspaceId: dto.workspaceId,
      mimeType: dto.mimeType,
      byteSize: dto.byteSize,
      kind: dto.kind ?? "other",
      originalFilename: dto.originalFilename ?? null,
    });
  }

  @Post(":id/complete")
  @HttpCode(200)
  async completeUpload(@CurrentUser() userId: string, @Param("id") id: string, @Body() dto: CompleteUploadDto) {
    return { asset: await this.assets.completeUpload(userId, id, dto.contentHash) };
  }

  @Get()
  async list(@CurrentUser() userId: string, @Query("workspaceId") workspaceId?: string) {
    if (!workspaceId) throw new ApiError(400, "workspaceId query param is required");
    return { assets: await this.assets.list(userId, workspaceId) };
  }

  @Get(":id")
  async get(@CurrentUser() userId: string, @Param("id") id: string) {
    return { asset: await this.assets.getForMember(userId, id) };
  }

  // Streams the asset's real bytes (image/video/font/etc.), as opposed to
  // `get()` above which only returns metadata. `?variant=poster|audio`
  // selects a derivative instead of the original upload.
  @Get(":id/media")
  async media(
    @CurrentUser() userId: string,
    @Param("id") id: string,
    @Query("variant") variantParam: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const variant = isMediaVariant(variantParam) ? variantParam : "original";
    const result = await this.assets.streamMedia(userId, id, variant, req.headers.range);
    if (result.outcome === "invalid-range") {
      res.set("Content-Range", `bytes */${result.totalSize}`);
      res.status(416).end();
      return;
    }
    res.status(result.status).set({
      "Content-Type": result.contentType,
      "Content-Length": String(result.contentLength),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      ...(result.contentRange ? { "Content-Range": result.contentRange } : {}),
    });
    result.body.pipe(res);
  }

  @Delete(":id")
  async softDelete(@CurrentUser() userId: string, @Param("id") id: string) {
    return { asset: await this.assets.softDelete(userId, id) };
  }

  // Which non-deleted projects currently reference this asset.
  @Get(":id/usage")
  async usage(@CurrentUser() userId: string, @Param("id") id: string) {
    return this.assets.getUsage(userId, id);
  }
}
