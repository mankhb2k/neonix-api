import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { RolesGuard } from "../auth/roles.guard";
import { decodeCursor, parseLimit } from "../common/pagination";
import { CreditsService } from "../credits/credits.service";
import { IapService } from "../iap/iap.service";
import { env } from "../env";
import { PacksService } from "./packs.service";
import { MAX_TOPUP_VND, MIN_TOPUP_VND, TopupsService, creditsForVnd } from "./topups.service";

class CreatePurchaseDto {
  /** StoreKit 2 `jwsRepresentation` of the finished transaction. */
  @IsString() @MinLength(10) signedTransaction!: string;
}

class CreatePayosOrderDto {
  @Type(() => Number) @IsInt() @Min(MIN_TOPUP_VND) @Max(MAX_TOPUP_VND) amountVnd!: number;
}

class UpsertPackDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) credits!: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

@ApiTags("Billing")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard)
@Controller("v1/billing")
export class BillingController {
  constructor(
    private readonly credits: CreditsService,
    private readonly iap: IapService,
    private readonly packs: PacksService,
    private readonly topups: TopupsService,
  ) {}

  @Get("packs")
  @ApiOperation({ summary: "Credit packs on sale (price text comes from StoreKit)" })
  listPacks() {
    return this.packs.listActive();
  }

  @Get("balance")
  @ApiOperation({ summary: "Current credit balance" })
  async balance(@CurrentUser() userId: string) {
    return { balance: await this.credits.getBalance(userId) };
  }

  @Get("ledger")
  @ApiOperation({ summary: "Credit history, newest first. Page with ?cursor=<nextCursor>" })
  ledger(@CurrentUser() userId: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.credits.listLedger(userId, parseLimit(limit, 50, 100), decodeCursor(cursor));
  }

  @Get("topup-rates")
  @ApiOperation({ summary: "Web top-up pricing: limits and what 1.000 VND buys" })
  topupRates() {
    return { minVnd: MIN_TOPUP_VND, maxVnd: MAX_TOPUP_VND, creditsPer1000Vnd: creditsForVnd(1000) };
  }

  @Post("payos/orders")
  @HttpCode(200)
  @ApiOperation({ summary: "Start a web top-up: returns a VietQR payment for the amount (website only)" })
  createPayosOrder(@CurrentUser() userId: string, @Body() body: CreatePayosOrderDto, @Headers("origin") origin?: string) {
    // Only ever redirect back to our own site, whatever the request claims.
    const returnOrigin = origin && env.webOrigins.includes(origin) ? origin : env.webOrigins[0];
    return this.topups.createOrder(userId, returnOrigin, body.amountVnd);
  }

  @Get("payos/orders/:orderCode")
  @ApiOperation({ summary: "Status of a web top-up; credits are granted once it is paid" })
  getPayosOrder(@CurrentUser() userId: string, @Param("orderCode", ParseIntPipe) orderCode: number) {
    return this.topups.getOrder(userId, orderCode);
  }

  @Post("purchases")
  @ApiOperation({ summary: "Verify an App Store purchase and credit it (safe to retry)" })
  createPurchase(@CurrentUser() userId: string, @Body() body: CreatePurchaseDto) {
    return this.iap.verifyPurchase(userId, body.signedTransaction);
  }

  @Get("purchases")
  @ApiOperation({ summary: "Purchase history, newest first" })
  listPurchases(@CurrentUser() userId: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.iap.listPurchases(userId, parseLimit(limit, 50, 100), decodeCursor(cursor));
  }
}

@ApiTags("Admin")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard, RolesGuard("admin"))
@Controller("v1/admin/credit-packs")
export class AdminCreditPacksController {
  constructor(private readonly packs: PacksService) {}

  @Get()
  @ApiOperation({ summary: "All credit packs, including inactive" })
  list() {
    return this.packs.listAll();
  }

  @Put(":productId")
  @ApiOperation({ summary: "Create or update a pack (productId = App Store Connect product id)" })
  upsert(@Param("productId") productId: string, @Body() body: UpsertPackDto) {
    return this.packs.upsert(productId, body);
  }
}
