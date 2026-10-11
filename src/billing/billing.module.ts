import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { IapModule } from "../iap/iap.module";
import { AdminCreditPacksController, BillingController } from "./billing.controller";
import { PacksService } from "./packs.service";

@Module({
  imports: [CreditsModule, IapModule],
  controllers: [BillingController, AdminCreditPacksController],
  providers: [PacksService],
})
export class BillingModule {}
