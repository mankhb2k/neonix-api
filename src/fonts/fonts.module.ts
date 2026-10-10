import { Module } from "@nestjs/common";
import { AuthzModule } from "../authz/authz.module";
import { R2Module } from "../r2/r2.module";
import { FontsController } from "./fonts.controller";
import { FontsService } from "./fonts.service";

@Module({
  imports: [AuthzModule, R2Module],
  controllers: [FontsController],
  providers: [FontsService],
})
export class FontsModule {}
