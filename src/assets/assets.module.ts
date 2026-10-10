import { Module } from "@nestjs/common";
import { AuthzModule } from "../authz/authz.module";
import { QuotasModule } from "../quotas/quotas.module";
import { R2Module } from "../r2/r2.module";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";

@Module({
  imports: [AuthzModule, QuotasModule, R2Module],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
