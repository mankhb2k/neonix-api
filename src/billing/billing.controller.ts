import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { BillingService } from "./billing.service";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";
import { CreatePayosOrderDto } from "./dto/create-payos-order.dto";

@UseGuards(CurrentUserGuard)
@Controller("v1/billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("balance")
  async balance(@CurrentUser() userId: string) {
    return { balanceVnd: await this.billing.getBalanceVnd(userId) };
  }

  @Post("checkout")
  @HttpCode(200)
  async checkout(@CurrentUser() userId: string, @Body() dto: CreateCheckoutDto, @Req() req: Request) {
    const origin = req.headers.origin ?? process.env.WEB_APP_URL ?? "";
    return this.billing.createTopupCheckout(userId, origin, dto.amountUsd);
  }

  // Creates a VND payment and returns the dynamic VietQR payload for it.
  @Post("payos/orders")
  @HttpCode(200)
  async createPayosOrder(@CurrentUser() userId: string, @Body() dto: CreatePayosOrderDto, @Req() req: Request) {
    const origin = req.headers.origin ?? process.env.WEB_APP_URL ?? "";
    return this.billing.createPayosOrder(userId, origin, dto.amountVnd);
  }

  @Get("payos/orders/:orderCode")
  async getPayosOrder(@CurrentUser() userId: string, @Param("orderCode", ParseIntPipe) orderCode: number) {
    return this.billing.getPayosOrder(userId, orderCode);
  }
}
