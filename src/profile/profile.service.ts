import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import { CreditsService } from "../credits/credits.service";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { user } from "../db/schema/auth";
import { profiles } from "../db/schema/profile";
import { avatarKey, imageExtension, R2Service } from "../r2/r2.service";

@Injectable()
export class ProfileService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly r2: R2Service,
    private readonly credits: CreditsService,
  ) {}

  async get(userId: string) {
    const profile = await this.db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
    if (!profile) throw new ApiError(404, "Profile not found");
    return {
      id: profile.id,
      displayName: profile.displayName,
      avatarUrl: this.r2.publicUrl("avatars", profile.avatarKey),
      role: profile.role,
      balance: await this.credits.getBalance(userId),
    };
  }

  async update(userId: string, patch: { displayName?: string; avatarKey?: string }) {
    if (patch.avatarKey !== undefined && !patch.avatarKey.startsWith(`avatars/${userId}/`)) {
      throw new ApiError(400, "Invalid avatar key", "INVALID_KEY");
    }
    await this.db
      .update(profiles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(profiles.id, userId));
    return this.get(userId);
  }

  async createAvatarUpload(userId: string, contentType: string) {
    const ext = imageExtension(contentType);
    if (!ext || contentType === "video/mp4") throw new ApiError(400, "Avatar must be png, jpeg or webp", "UNSUPPORTED_TYPE");
    const key = avatarKey(userId, ext);
    return { key, upload: await this.r2.presignPut("avatars", key, contentType) };
  }

  /** In-app account deletion (App Store requirement); FK cascades remove the rest. */
  async deleteAccount(userId: string) {
    await this.db.delete(user).where(eq(user.id, userId));
  }
}
