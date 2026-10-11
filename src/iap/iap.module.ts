import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { IapController } from "./iap.controller";
import { IapService } from "./iap.service";

@Module({ imports: [CreditsModule], controllers: [IapController], providers: [IapService], exports: [IapService] })
export class IapModule {}
