import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { StickersService } from "./stickers.service";

/** The built-in sticker library any signed-in user can use in the editor. */
@ApiTags("Stickers")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard)
@Controller("v1/stickers")
export class StickersController {
  constructor(private readonly stickers: StickersService) {}

  @Get()
  @ApiOperation({ summary: "The sticker catalogue: categories and every sticker with a download URL (public, or presigned until a public domain is set)" })
  list() {
    return this.stickers.catalogue();
  }
}
