import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { R2Module } from "../r2/r2.module";
import { ProfileController } from "./profile.controller";
import { ProfileService } from "./profile.service";

@Module({ imports: [CreditsModule, R2Module], controllers: [ProfileController], providers: [ProfileService] })
export class ProfileModule {}
