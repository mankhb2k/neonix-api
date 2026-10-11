import { Module } from "@nestjs/common";
import { AdminController } from "../admin/admin.controller";
import { R2Module } from "../r2/r2.module";
import { CreatorTemplatesController, TemplatesController } from "./templates.controller";
import { TemplatesService } from "./templates.service";

@Module({
  imports: [R2Module],
  controllers: [TemplatesController, CreatorTemplatesController, AdminController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
