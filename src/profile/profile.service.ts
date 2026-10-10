import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { profiles } from "../db/schema/identity";
import { avatarObjectKey, R2Service } from "../r2/r2.service";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function avatarPublicUrl(key: string): string {
  return `${requiredEnv("R2_AVATARS_PUBLIC_URL").replace(/\/$/, "")}/${key}`;
}

@Injectable()
export class ProfileService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly r2: R2Service,
  ) {}

  async getProfile(userId: string) {
    const profile = await this.db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
    if (!profile) throw new ApiError(404, "Profile not found");
    return profile;
  }

  async updateDisplayName(userId: string, displayName: string) {
    const [updated] = await this.db
      .update(profiles)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning();
    if (!updated) throw new ApiError(404, "Profile not found");
    return updated;
  }

  async uploadAvatar(userId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    if (!ALLOWED_AVATAR_TYPES.has(file.mimetype)) {
      throw new ApiError(400, "Use a JPEG, PNG, WebP, or GIF image.");
    }
    if (file.size < 1 || file.size > MAX_AVATAR_BYTES) {
      throw new ApiError(400, "Avatar images must be smaller than 5 MB.");
    }

    const existing = await this.db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
    if (!existing) throw new ApiError(404, "Profile not found");

    const key = avatarObjectKey(userId, randomUUID(), file.mimetype);
    await this.r2.putObject("R2_AVATARS_BUCKET", { key, body: file.buffer, contentType: file.mimetype });
    const avatarUrl = avatarPublicUrl(key);
    const avatarUpdatedAt = new Date();

    const [updated] = await this.db
      .update(profiles)
      .set({
        avatarUrl,
        avatarPath: key,
        avatarMimeType: file.mimetype,
        avatarSizeBytes: file.size,
        avatarUpdatedAt,
        updatedAt: avatarUpdatedAt,
      })
      .where(eq(profiles.id, userId))
      .returning();

    const previousAvatarPath = existing.avatarPath;
    if (previousAvatarPath && previousAvatarPath !== key) {
      await this.r2.deleteObject("R2_AVATARS_BUCKET", previousAvatarPath).catch(() => undefined);
    }

    return updated;
  }

  async removeAvatar(userId: string) {
    const existing = await this.db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
    if (!existing) throw new ApiError(404, "Profile not found");
    if (!existing.avatarPath) return { avatarUrl: null };

    await this.r2.deleteObject("R2_AVATARS_BUCKET", existing.avatarPath);
    await this.db
      .update(profiles)
      .set({ avatarUrl: null, avatarPath: null, avatarMimeType: null, avatarSizeBytes: null, avatarUpdatedAt: null, updatedAt: new Date() })
      .where(eq(profiles.id, userId));
    return { avatarUrl: null };
  }
}
