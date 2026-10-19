import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { RolesGuard } from "../auth/roles.guard";
import { decodeCursor, parseLimit } from "../common/pagination";
import { TemplatesService } from "./templates.service";

class CreateTemplateDto {
  @IsString() @MinLength(1) @MaxLength(80) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
}

class UpdateTemplateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() posterKey?: string;
  @IsOptional() @IsString() previewKey?: string;
  @IsOptional() @IsBoolean() unlisted?: boolean;
}

class PreviewUploadDto {
  @IsIn(["image/png", "image/jpeg", "image/webp", "video/mp4"]) contentType!: string;
  /** "poster" (default for images in the app) is required before submit; "preview" is an optional looping video. */
  @IsOptional() @IsIn(["poster", "preview"]) kind?: "poster" | "preview";
}

class CreateVersionDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) formatVersion?: number;
  @IsOptional() @IsString() @MaxLength(20) minAppVersion?: string;
}

// Summary of manifest.json (docs/template-package.md); display/filter only.
class CompleteUploadDto {
  @Matches(/^[0-9a-fA-F]{64}$/) sha256!: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(200) slotCount!: number;
  @Type(() => Number) @IsInt() @Min(16) @Max(8192) width!: number;
  @Type(() => Number) @IsInt() @Min(16) @Max(8192) height!: number;
  @Type(() => Number) @IsInt() @Min(100) @Max(3_600_000) durationMs!: number;
}

/** Public catalogue and package downloads. Creator management remains protected below. */
@ApiTags("Templates")
@Controller("v1/templates")
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @ApiOperation({ summary: "Browse published templates, newest first. Page with ?cursor=<nextCursor>" })
  list(@Query("category") category?: string, @Query("q") q?: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.templates.list(undefined, { category, q, limit: parseLimit(limit, 20, 50), cursor: decodeCursor(cursor) });
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.templates.getPublished(undefined, id);
  }

  /** Presigned download of the template zip, free: credits are spent at export. */
  @Get(":id/package")
  @ApiOperation({ summary: "Presigned download of the template zip (free; the first export buys the template)" })
  getPackage(@Param("id", ParseUUIDPipe) id: string, @Query("versionId") versionId?: string) {
    return this.templates.getPackage(id, versionId);
  }
}

@ApiTags("Creator")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard, RolesGuard("creator", "admin"))
@Controller("v1/creator/templates")
export class CreatorTemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  mine(@CurrentUser() userId: string) {
    return this.templates.listMine(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() body: CreateTemplateDto) {
    return this.templates.create(userId, body);
  }

  @Patch(":id")
  update(@CurrentUser() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: UpdateTemplateDto) {
    return this.templates.update(userId, id, body);
  }

  @Post(":id/preview-upload")
  previewUpload(@CurrentUser() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: PreviewUploadDto) {
    return this.templates.createPreviewUpload(userId, id, body.contentType, body.kind);
  }

  @Post(":id/versions")
  createVersion(@CurrentUser() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: CreateVersionDto) {
    return this.templates.createVersion(userId, id, body);
  }

  @Post(":id/versions/:version/complete")
  @HttpCode(200)
  complete(
    @CurrentUser() userId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("version", ParseIntPipe) version: number,
    @Body() body: CompleteUploadDto,
  ) {
    const { sha256, ...summary } = body;
    return this.templates.completeUpload(userId, id, version, sha256, summary);
  }

  @Post(":id/versions/:version/submit")
  @HttpCode(200)
  submit(@CurrentUser() userId: string, @Param("id", ParseUUIDPipe) id: string, @Param("version", ParseIntPipe) version: number) {
    return this.templates.submitForReview(userId, id, version);
  }
}
