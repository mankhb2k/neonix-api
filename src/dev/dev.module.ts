import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { DevController } from "./dev.controller";

@Module({ imports: [CreditsModule], controllers: [DevController] })
export class DevModule {}
