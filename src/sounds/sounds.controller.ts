import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { SoundsService } from "./sounds.service";

/** The built-in sound-effect library any signed-in user can listen to and use in the editor. */
@ApiTags("Sounds")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard)
@Controller("v1/sounds")
export class SoundsController {
  constructor(private readonly sounds: SoundsService) {}

  @Get()
  @ApiOperation({ summary: "The sound-effect catalogue: categories and every sound with a play/download URL (public, or presigned until a public domain is set)" })
  list() {
    return this.sounds.catalogue();
  }
}
