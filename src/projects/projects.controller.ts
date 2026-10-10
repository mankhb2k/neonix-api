import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ApiError } from "../common/api-error";
import { AttachAssetDto } from "./dto/attach-asset.dto";
import { CreateHtmlProjectDto } from "./dto/create-html-project.dto";
import { UpdateHtmlDocumentDto } from "./dto/update-html-document.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { ProjectsService } from "./projects.service";

@UseGuards(CurrentUserGuard)
@Controller("v1/projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(@CurrentUser() userId: string, @Query("workspaceId") workspaceId?: string) {
    if (!workspaceId) throw new ApiError(400, "workspaceId query param is required");
    return { projects: await this.projects.list(userId, workspaceId) };
  }

  // Creates an HTML project (stored as-is).
  @Post("html-raw")
  async createHtmlProject(@CurrentUser() userId: string, @Body() dto: CreateHtmlProjectDto) {
    const result = await this.projects.createHtmlProject(userId, dto);
    return { project: result.project, alreadyCreated: result.alreadyCreated };
  }

  @Get(":id")
  async get(@CurrentUser() userId: string, @Param("id") id: string) {
    return { project: await this.projects.getForMember(userId, id) };
  }

  @Patch(":id")
  async update(@CurrentUser() userId: string, @Param("id") id: string, @Body() dto: UpdateProjectDto) {
    return { project: await this.projects.update(userId, id, dto.title) };
  }

  @Delete(":id")
  async softDelete(@CurrentUser() userId: string, @Param("id") id: string) {
    return { project: await this.projects.softDelete(userId, id) };
  }

  @Post(":id/restore")
  @HttpCode(200)
  async restore(@CurrentUser() userId: string, @Param("id") id: string) {
    return { project: await this.projects.restore(userId, id) };
  }

  // Links an existing workspace asset into this project's asset list.
  // Idempotent - attaching the same asset twice is a no-op.
  @Post(":id/assets")
  @HttpCode(200)
  async attachAsset(@CurrentUser() userId: string, @Param("id") id: string, @Body() dto: AttachAssetDto) {
    await this.projects.attachAsset(userId, id, dto.assetId);
    return { ok: true };
  }

  // Current HTML document only, no revision history.
  @Get(":id/html")
  async getHtmlDocument(@CurrentUser() userId: string, @Param("id") id: string) {
    const result = await this.projects.getHtmlDocument(userId, id);
    return { project: result.project, html: result.html, updatedAt: result.updatedAt };
  }

  @Put(":id/html")
  async updateHtmlDocument(@CurrentUser() userId: string, @Param("id") id: string, @Body() dto: UpdateHtmlDocumentDto) {
    const result = await this.projects.updateHtmlDocument(userId, id, dto.html);
    return { project: result.project, html: result.html, updatedAt: result.updatedAt };
  }
}
