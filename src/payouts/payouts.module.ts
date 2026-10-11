import { Module } from "@nestjs/common";
import { AdminPayoutsController, CreatorPayoutsController } from "./payouts.controller";
import { PayoutsService } from "./payouts.service";

@Module({ controllers: [CreatorPayoutsController, AdminPayoutsController], providers: [PayoutsService] })
export class PayoutsModule {}
