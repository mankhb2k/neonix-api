import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { BillingModule } from "./billing/billing.module";
import { CreditsModule } from "./credits/credits.module";
import { DevModule } from "./dev/dev.module";
import { env } from "./env";
import { DatabaseModule } from "./db/database.module";
import { ExportsModule } from "./exports/exports.module";
import { IapModule } from "./iap/iap.module";
import { ProfileModule } from "./profile/profile.module";
import { PayoutsModule } from "./payouts/payouts.module";
import { TemplatesModule } from "./templates/templates.module";

@Module({
  imports: [DatabaseModule, ProfileModule, CreditsModule, IapModule, BillingModule, TemplatesModule, ExportsModule, PayoutsModule, ...(env.devAuthBypass ? [DevModule] : [])],
  controllers: [AppController],
})
export class AppModule {}
