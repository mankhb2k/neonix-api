import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ApiError } from "../common/api-error";
import { ExportsService } from "./exports.service";

@UseGuards(CurrentUserGuard)
@Controller("v1/exports")
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get()
  async list(@CurrentUser() userId: string, @Query("workspaceId") workspaceId?: string) {
    if (!workspaceId) throw new ApiError(400, "workspaceId query param is required");
    return { exports: await this.exportsService.list(userId, workspaceId) };
  }

  // Declared before ":id/download" so "summary" is not read as an export id.
  @Get("summary")
  async summary(@CurrentUser() userId: string, @Query("workspaceId") workspaceId?: string) {
    if (!workspaceId) throw new ApiError(400, "workspaceId query param is required");
    return this.exportsService.summary(userId, workspaceId);
  }

  @Get(":id/download")
  async download(@CurrentUser() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    const signed = await this.exportsService.getDownloadUrl(userId, id);
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }
}
