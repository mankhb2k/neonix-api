import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ApiError } from "../common/api-error";
import { CompleteFontUploadDto } from "./dto/complete-font-upload.dto";
import { CreateFontFaceDto } from "./dto/create-font-face.dto";
import { CreateFontFamilyDto } from "./dto/create-font-family.dto";
import { ProjectFontLinkDto } from "./dto/project-font-link.dto";
import { FontsService } from "./fonts.service";

@UseGuards(CurrentUserGuard)
@Controller("v1/fonts")
export class FontsController {
  constructor(private readonly fonts: FontsService) {}

  // Auto-parses the just-uploaded font binary (fontkit) and auto-creates or
  // reuses the family by name - a richer, one-shot alternative to
  // families/:id/faces below (which requires the caller to already know
  // weight/style/format).
  @Post("upload/complete")
  async completeFontUpload(@CurrentUser() userId: string, @Body() dto: CompleteFontUploadDto) {
    return { font: await this.fonts.completeFontUpload(userId, dto.assetId) };
  }

  @Get("families")
  async listFamilies(@CurrentUser() userId: string, @Query("workspaceId") workspaceId?: string) {
    if (!workspaceId) throw new ApiError(400, "workspaceId query param is required");
    return { fontFamilies: await this.fonts.listFamilies(userId, workspaceId) };
  }

  @Post("families")
  async createFamily(@CurrentUser() userId: string, @Body() dto: CreateFontFamilyDto) {
    return { fontFamily: await this.fonts.createFamily(userId, dto) };
  }

  @Get("families/:familyId")
  async getFamily(@CurrentUser() userId: string, @Param("familyId") familyId: string) {
    return { fontFamily: await this.fonts.getFamily(userId, familyId) };
  }

  @Delete("families/:familyId")
  @HttpCode(204)
  async deleteFamily(@CurrentUser() userId: string, @Param("familyId") familyId: string) {
    await this.fonts.deleteFamily(userId, familyId);
  }

  @Get("families/:familyId/faces")
  async listFaces(@CurrentUser() userId: string, @Param("familyId") familyId: string) {
    return { fontFaces: await this.fonts.listFaces(userId, familyId) };
  }

  @Post("families/:familyId/faces")
  async createFace(@CurrentUser() userId: string, @Param("familyId") familyId: string, @Body() dto: CreateFontFaceDto) {
    return {
      fontFace: await this.fonts.createFace(userId, familyId, {
        assetId: dto.assetId,
        faceKey: dto.faceKey,
        weight: dto.weight,
        style: dto.style ?? "normal",
        widthClass: dto.widthClass ?? "normal",
        format: dto.format,
      }),
    };
  }

  @Delete("faces/:faceId")
  @HttpCode(204)
  async deleteFace(@CurrentUser() userId: string, @Param("faceId") faceId: string) {
    await this.fonts.deleteFace(userId, faceId);
  }

  @Post("project-links")
  async createProjectLink(@CurrentUser() userId: string, @Body() dto: ProjectFontLinkDto) {
    return {
      projectFontFamily: await this.fonts.createProjectLink(userId, {
        projectId: dto.projectId,
        fontFamilyId: dto.fontFamilyId,
        alias: dto.alias?.trim() ?? null,
      }),
    };
  }

  @Get("project-links")
  async listProjectLinks(@CurrentUser() userId: string, @Query("projectId") projectId?: string) {
    if (!projectId) throw new ApiError(400, "projectId query param is required");
    return { projectFontFamilies: await this.fonts.listProjectLinks(userId, projectId) };
  }

  @Delete("project-links")
  @HttpCode(204)
  async deleteProjectLink(@CurrentUser() userId: string, @Body() dto: ProjectFontLinkDto) {
    await this.fonts.deleteProjectLink(userId, dto.projectId, dto.fontFamilyId);
  }
}
