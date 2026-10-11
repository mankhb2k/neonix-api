import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Body, Controller, Delete, Get, HttpCode, Patch, Post, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ProfileService } from "./profile.service";

class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) displayName?: string;
  @IsOptional() @IsString() avatarKey?: string;
}

class AvatarUploadDto {
  @IsIn(["image/png", "image/jpeg", "image/webp"]) contentType!: string;
}

@ApiTags("Auth")
@ApiBearerAuth()
@UseGuards(CurrentUserGuard)
@Controller("v1/me")
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get(@CurrentUser() userId: string) {
    return this.profile.get(userId);
  }

  @Patch()
  update(@CurrentUser() userId: string, @Body() body: UpdateProfileDto) {
    return this.profile.update(userId, body);
  }

  /** Returns a presigned PUT; then PATCH /v1/me with the returned `key` as `avatarKey`. */
  @Post("avatar-upload")
  avatarUpload(@CurrentUser() userId: string, @Body() body: AvatarUploadDto) {
    return this.profile.createAvatarUpload(userId, body.contentType);
  }

  @Delete()
  @HttpCode(204)
  async remove(@CurrentUser() userId: string) {
    await this.profile.deleteAccount(userId);
  }
}
