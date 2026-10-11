import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { ExportsController } from "./exports.controller";
import { ExportsService } from "./exports.service";

@Module({ imports: [CreditsModule], controllers: [ExportsController], providers: [ExportsService] })
export class ExportsModule {}
