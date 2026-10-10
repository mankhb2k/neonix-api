import { Module } from "@nestjs/common";
import { QuotasModule } from "../quotas/quotas.module";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";

@Module({
  imports: [QuotasModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
