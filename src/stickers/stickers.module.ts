import { Module } from "@nestjs/common";
import { R2Module } from "../r2/r2.module";
import { StickersController } from "./stickers.controller";
import { StickersService } from "./stickers.service";

@Module({ imports: [R2Module], controllers: [StickersController], providers: [StickersService] })
export class StickersModule {}
