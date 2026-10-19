import { Module } from "@nestjs/common";
import { R2Module } from "../r2/r2.module";
import { SoundsController } from "./sounds.controller";
import { SoundsService } from "./sounds.service";

@Module({ imports: [R2Module], controllers: [SoundsController], providers: [SoundsService] })
export class SoundsModule {}
