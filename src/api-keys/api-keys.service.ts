import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { apiKeys } from "../db/schema/api-keys";

const TOKEN_PREFIX = "nx_live_";

function normalizeName(value: string | undefined): string {
  const name = value?.trim() || "Default key";
  if (name.length > 80) throw new ApiError(400, "API key name is too long.");
  return name;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicKey(row: typeof apiKeys.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(userId: string) {
    const rows = await this.db.query.apiKeys.findMany({
      where: and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)),
      orderBy: [desc(apiKeys.createdAt)],
    });
    return rows.map(publicKey);
  }

  async create(userId: string, rawName?: string) {
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const [row] = await this.db
      .insert(apiKeys)
      .values({
        userId,
        name: normalizeName(rawName),
        prefix: token.slice(0, TOKEN_PREFIX.length + 8),
        keyHash: hashToken(token),
      })
      .returning();
    if (!row) throw new ApiError(500, "Could not create API key.");
    return { ...publicKey(row), token };
  }

  async rename(userId: string, id: string, rawName: string) {
    const name = rawName.trim();
    if (!name) throw new ApiError(400, "API key name is required.");
    if (name.length > 80) throw new ApiError(400, "API key name is too long.");
    const [row] = await this.db
      .update(apiKeys)
      .set({ name })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .returning();
    if (!row) throw new ApiError(404, "API key not found.");
    return publicKey(row);
  }

  async revoke(userId: string, id: string): Promise<void> {
    const result = await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (result.length === 0) throw new ApiError(404, "API key not found.");
  }
}
