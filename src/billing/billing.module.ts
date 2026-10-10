import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { PayosService } from "./payos.service";
import { PolarService } from "./polar.service";
import { WebhooksController } from "./webhooks.controller";

@Module({
  controllers: [BillingController, WebhooksController],
  providers: [BillingService, PolarService, PayosService],
})
export class BillingModule {}
