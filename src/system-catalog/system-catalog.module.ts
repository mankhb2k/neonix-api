import { Module } from "@nestjs/common";
import { R2Module } from "../r2/r2.module";
import { SystemCatalogController } from "./system-catalog.controller";
import { SystemCatalogService } from "./system-catalog.service";

@Module({
  imports: [R2Module],
  controllers: [SystemCatalogController],
  providers: [SystemCatalogService],
})
export class SystemCatalogModule {}
