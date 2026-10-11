import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { CreditsService } from "../credits/credits.service";
import { Inject } from "@nestjs/common";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";

class GrantDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) amount!: number;
}

// Only registered when DEV_AUTH_BYPASS=true (see app.module.ts).
@ApiTags("Dev")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard)
@Controller("v1/dev")
export class DevController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly credits: CreditsService,
  ) {}

  @Post("credits")
  @ApiOperation({ summary: "DEV ONLY: give the current user test credits" })
  async grant(@CurrentUser() userId: string, @Body() body: GrantDto) {
    return this.db.transaction((tx) =>
      this.credits.applyDelta(tx, { userId, delta: body.amount, reason: "grant", idempotencyKey: `dev-grant:${randomUUID()}` }),
    );
  }
}
