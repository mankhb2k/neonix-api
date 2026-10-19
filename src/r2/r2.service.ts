import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Three buckets in one Cloudflare account, one purpose each:
//  - templates: private template zips, only via short-lived presigned URLs
//  - previews:  public template preview images/videos, served from R2_TEMPLATE_PREVIEWS_URL
//  - avatars:   public user avatars, served from R2_AVATARS_URL
//  - system:    Neonix's own assets (stickers/, soudeffects/ ...); R2_SYSTEM_ASSETS_URL is optional - without it the API hands out
//               short-lived presigned URLs instead of public ones (`systemAssetUrl`)
export type Bucket = "templates" | "previews" | "avatars" | "system";
export type PublicBucket = "previews" | "avatars";

const BUCKET_ENV: Record<Bucket, string> = {
  templates: "R2_TEMPLATES_BUCKET",
  previews: "R2_TEMPLATE_PREVIEWS_BUCKET",
  avatars: "R2_AVATARS_BUCKET",
  system: "R2_SYSTEM_ASSETS_BUCKET",
};
const PUBLIC_URL_ENV: Record<PublicBucket, string> = {
  previews: "R2_TEMPLATE_PREVIEWS_URL",
  avatars: "R2_AVATARS_URL",
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

export function imageExtension(contentType: string): string | null {
  return IMAGE_EXTENSIONS[contentType] ?? null;
}

// Everything a creator owns lives under creators/{creatorId}/, so "whose file is this?" is
// readable from the key and a whole creator can be cleaned up by prefix. The DB stays the
// source of truth; code never parses these keys.
export const creatorPrefix = (creatorId: string, templateId: string) => `creators/${creatorId}/${templateId}/`;
export const templatePackageKey = (creatorId: string, templateId: string, version: number) =>
  `${creatorPrefix(creatorId, templateId)}v${version}/package.zip`;
export const previewKey = (creatorId: string, templateId: string, ext: string) =>
  `${creatorPrefix(creatorId, templateId)}${randomUUID()}.${ext}`;
export const avatarKey = (userId: string, ext: string) => `avatars/${userId}/${randomUUID()}.${ext}`;

@Injectable()
export class R2Service {
  private client: S3Client | null = null;

  private ensureClient(): S3Client {
    if (this.client) return this.client;
    this.client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT?.trim() || `https://${requiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
    return this.client;
  }

  private bucketName(bucket: Bucket): string {
    return requiredEnv(BUCKET_ENV[bucket]);
  }

  publicUrl(bucket: PublicBucket, key: string | null): string | null {
    if (!key) return null;
    return `${requiredEnv(PUBLIC_URL_ENV[bucket]).replace(/\/$/, "")}/${key}`;
  }

  /** A URL for one of Neonix's own assets: public when R2_SYSTEM_ASSETS_URL is set, otherwise presigned for an hour. */
  async systemAssetUrl(key: string): Promise<string> {
    const base = process.env.R2_SYSTEM_ASSETS_URL?.trim();
    if (base) return `${base.replace(/\/$/, "")}/${key}`;
    return (await this.presignGet("system", key, 3600)).url;
  }

  /** Reads a small text object (a manifest). */
  async getText(bucket: Bucket, key: string): Promise<string> {
    const result = await this.ensureClient().send(new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }));
    return (await result.Body?.transformToString("utf-8")) ?? "";
  }

  async presignPut(bucket: Bucket, key: string, contentType: string, expiresInSeconds = 900) {
    const url = await getSignedUrl(
      this.ensureClient(),
      new PutObjectCommand({ Bucket: this.bucketName(bucket), Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
    return { url, headers: { "content-type": contentType }, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }

  async presignGet(bucket: Bucket, key: string, expiresInSeconds = 900) {
    const url = await getSignedUrl(
      this.ensureClient(),
      new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      { expiresIn: expiresInSeconds },
    );
    return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }

  async headObject(bucket: Bucket, key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const result = await this.ensureClient().send(new HeadObjectCommand({ Bucket: this.bucketName(bucket), Key: key }));
      return { sizeBytes: result.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  async deleteObject(bucket: Bucket, key: string): Promise<void> {
    await this.ensureClient().send(new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: key }));
  }
}
