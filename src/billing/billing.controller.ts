import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { RolesGuard } from "../auth/roles.guard";
import { decodeCursor, parseLimit } from "../common/pagination";
import { CreditsService } from "../credits/credits.service";
import { IapService } from "../iap/iap.service";
import { PacksService } from "./packs.service";

class CreatePurchaseDto {
  /** StoreKit 2 `jwsRepresentation` of the finished transaction. */
  @IsString() @MinLength(10) signedTransaction!: string;
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
