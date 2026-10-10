import { Module } from "@nestjs/common";
import { AuthzModule } from "../authz/authz.module";
import { QuotasModule } from "../quotas/quotas.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  imports: [AuthzModule, QuotasModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
