import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ExportsService } from "./exports.service";

class CreateExportDto {
  @IsUUID() templateId!: string;
  /** Version the project was started from; default = the template's current version. */
  @IsOptional() @IsUUID() versionId?: string;
}

@ApiTags("Exports")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard)
@Controller("v1/exports")
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: "Ask to export a template project, right before rendering on device",
    description:
      "The first export of a template buys it: its credit price is spent (`charged: true`) and it is the user's for good. " +
      "Every later export of that template is free (`charged: false`). Not enough credits = 402, nothing is recorded. Safe to retry.",
  })
  create(@CurrentUser() userId: string, @Body() body: CreateExportDto) {
    return this.exports.create(userId, body);
  }
}
