import { Module } from "@nestjs/common";
import { AuthzModule } from "../authz/authz.module";
import { QuotasModule } from "../quotas/quotas.module";
import { R2Module } from "../r2/r2.module";
import { ExportsController } from "./exports.controller";
import { ExportsService } from "./exports.service";

@Module({
  imports: [AuthzModule, QuotasModule, R2Module],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
