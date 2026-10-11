import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import { IsString, Matches, MaxLength, MinLength } from "class-validator";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { RolesGuard } from "../auth/roles.guard";
import { PayoutsService } from "./payouts.service";

class PayoutAccountDto {
  @IsString() @MinLength(2) @MaxLength(60) bankName!: string;
  @Matches(/^\d{6,20}$/, { message: "accountNumber must be 6-20 digits" }) accountNumber!: string;
  @IsString() @MinLength(2) @MaxLength(80) accountHolder!: string;
}

class MarkPaidDto {
  @IsString() @MinLength(1) @MaxLength(100) transferReference!: string;
}

@ApiTags("Creator")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard, RolesGuard("creator", "admin"))
@Controller("v1/creator")
export class CreatorPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get("payout-account")
  async account(@CurrentUser() userId: string) {
    return { account: await this.payouts.getAccount(userId) };
  }

  @Put("payout-account")
  setAccount(@CurrentUser() userId: string, @Body() body: PayoutAccountDto) {
    return this.payouts.setAccount(userId, body);
  }

  @Get("earnings")
  earnings(@CurrentUser() userId: string) {
    return this.payouts.earnings(userId);
  }
}

@ApiTags("Admin")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard, RolesGuard("admin"))
@Controller("v1/admin/payouts")
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  /** Run weekly (Monday, Vietnam time). Safe to re-run: a creator is never paid twice for the same week. */
  @Post("generate")
  @HttpCode(200)
  generate() {
    return this.payouts.generateWeekly();
  }

  @Get()
  list(@Query("status") status?: string) {
    return this.payouts.list(status === "pending" || status === "paid" ? status : undefined);
  }

  @Post(":id/mark-paid")
  @HttpCode(200)
  markPaid(@Param("id", ParseUUIDPipe) id: string, @Body() body: MarkPaidDto) {
    return this.payouts.markPaid(id, body.transferReference);
  }
}
