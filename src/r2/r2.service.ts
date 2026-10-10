import { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Shared object-key conventions and
// presign behavior. One S3Client, shared across every R2 bucket in this
// Cloudflare account (same account/credentials); each method takes an
// explicit `bucket` argument rather than a service-wide default, since
// different buckets have very different access shapes (user-assets is
// private/presigned-only, avatars is public-read via a custom domain).

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    case "video/mp4": return "mp4";
    case "video/webm": return "webm";
    case "audio/mpeg": return "mp3";
    case "audio/wav": return "wav";
    case "audio/aac": return "aac";
    case "audio/ogg": return "ogg";
    case "font/ttf": return "ttf";
    case "font/otf": return "otf";
    case "font/woff": return "woff";
    case "font/woff2": return "woff2";
    default: return "bin";
  }
}

function safeStorageId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function defaultObjectKey(workspaceId: string, assetId: string, mimeType: string): string {
  return `media/${safeStorageId(workspaceId)}/${safeStorageId(assetId)}/origin.${extensionForMime(mimeType)}`;
}

/** `{userId}/{avatarId}.{ext}` inside the avatars bucket - one object per uploaded avatar, never overwritten in place (see profile.service.ts). */
export function avatarObjectKey(userId: string, avatarId: string, mimeType: string): string {
  return `${safeStorageId(userId)}/${safeStorageId(avatarId)}.${extensionForMime(mimeType)}`;
}

export type PresignPutResult = {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
};

export type PresignGetResult = {
  url: string;
  expiresAt: Date;
};

@Injectable()
export class R2Service {
  private client: S3Client | null = null;
  private readonly bucketNames = new Map<string, string>();

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

  /** Resolves an env var (e.g. R2_USER_ASSETS_BUCKET) to the real bucket name, once per process. */
  private bucketFromEnv(envVarName: string): string {
    const cached = this.bucketNames.get(envVarName);
    if (cached) return cached;
    const bucket = requiredEnv(envVarName);
    this.bucketNames.set(envVarName, bucket);
    return bucket;
  }

  async putObject(bucketEnvVar: string, input: { key: string; body: Buffer | Readable; contentType: string }): Promise<void> {
    const client = this.ensureClient();
    const bucket = this.bucketFromEnv(bucketEnvVar);
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: input.key, Body: input.body, ContentType: input.contentType }));
  }

  async getObject(bucketEnvVar: string, key: string): Promise<Buffer | null> {
    const client = this.ensureClient();
    const bucket = this.bucketFromEnv(bucketEnvVar);
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch {
      return null;
    }
  }

  async headObject(bucketEnvVar: string, key: string): Promise<{ sizeBytes: number; contentType?: string } | null> {
    const client = this.ensureClient();
    const bucket = this.bucketFromEnv(bucketEnvVar);
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch {
      return null;
    }
  }

  /** Streams an object's body, optionally scoped to an HTTP Range (`bytes=...`) for partial content. */
  async getObjectStream(bucketEnvVar: string, key: string, range?: string): Promise<{ body: Readable; contentType?: string } | null> {
    const client = this.ensureClient();
    const bucket = this.bucketFromEnv(bucketEnvVar);
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
      if (!result.Body) return null;
      return { body: result.Body as Readable, contentType: result.ContentType };
    } catch {
      return null;
    }
  }

  async deleteObject(bucketEnvVar: string, key: string): Promise<void> {
    const client = this.ensureClient();
    const bucket = this.bucketFromEnv(bucketEnvVar);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async presignPut(bucketEnvVar: string, key: string, contentType: string, expiresInSeconds: number): Promise<PresignPutResult> {
    const client = this.ensureClient();
    const bucket = this.bucketFromEnv(bucketEnvVar);
    const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
      expiresIn: expiresInSeconds,
    });
    return { url, headers: { "content-type": contentType }, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }

  async presignGet(bucketEnvVar: string, key: string, expiresInSeconds: number): Promise<PresignGetResult> {
    const client = this.ensureClient();
    const bucket = this.bucketFromEnv(bucketEnvVar);
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
    return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }
}
