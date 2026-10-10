import { Body, Controller, Delete, Get, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
// Side-effect only: pulls in @types/multer's `Express.Multer.File` global
// augmentation - apps/api's tsconfig.json pins `"types": ["node"]`, so
// ambient packages aren't auto-included and need an explicit reference.
import type {} from "multer";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ApiError } from "../common/api-error";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ProfileService } from "./profile.service";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

@UseGuards(CurrentUserGuard)
@Controller("v1/profile")
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  async get(@CurrentUser() userId: string) {
    return { profile: await this.profile.getProfile(userId) };
  }

  @Patch()
  async update(@CurrentUser() userId: string, @Body() dto: UpdateProfileDto) {
    return { profile: await this.profile.updateDisplayName(userId, dto.displayName) };
  }

  @Post("avatar")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_AVATAR_BYTES } }))
  async uploadAvatar(@CurrentUser() userId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new ApiError(400, "An avatar image is required.");
    return await this.profile.uploadAvatar(userId, file);
  }

  @Delete("avatar")
  async removeAvatar(@CurrentUser() userId: string) {
    return await this.profile.removeAvatar(userId);
  }
}
