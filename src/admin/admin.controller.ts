import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { RolesGuard } from "../auth/roles.guard";
import { TemplatesService } from "../templates/templates.service";

class RejectDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

class AdminUpdateTemplateDto {
  /** Credits a user pays per export. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) creditCost?: number;
  /** VND the creator earns per export (fixed). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000) creatorEarningVnd?: number;
  @IsOptional() @IsIn(["published", "unlisted"]) status?: "published" | "unlisted";
}

@ApiTags("Admin")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard, RolesGuard("admin"))
@Controller("v1/admin")
export class AdminController {
  constructor(private readonly templates: TemplatesService) {}

  @Patch("templates/:id")
  updateTemplate(@Param("id", ParseUUIDPipe) id: string, @Body() body: AdminUpdateTemplateDto) {
    return this.templates.adminUpdate(id, body);
  }

  // Versions land here only when reviewPolicy returns `manual` (see templates/review-policy.ts).
  @Get("template-versions/in-review")
  inReview() {
    return this.templates.listInReview();
  }

  @Post("template-versions/:versionId/approve")
  @HttpCode(200)
  approve(@Param("versionId", ParseUUIDPipe) versionId: string) {
    return this.templates.review(versionId, { approve: true });
  }

  @Post("template-versions/:versionId/reject")
  @HttpCode(200)
  reject(@Param("versionId", ParseUUIDPipe) versionId: string, @Body() body: RejectDto) {
    return this.templates.review(versionId, { approve: false, reason: body.reason });
  }
}
