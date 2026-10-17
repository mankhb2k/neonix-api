import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { IapModule } from "../iap/iap.module";
import { AdminCreditPacksController, BillingController } from "./billing.controller";
import { PacksService } from "./packs.service";
import { PayosService } from "./payos.service";
import { PayosWebhookController } from "./payos-webhook.controller";
import { TopupsService } from "./topups.service";

@Module({
  imports: [CreditsModule, IapModule],
  controllers: [BillingController, AdminCreditPacksController, PayosWebhookController],
  providers: [PacksService, PayosService, TopupsService],
})
export class BillingModule {}
