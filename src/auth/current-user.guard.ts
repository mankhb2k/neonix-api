import { createHash } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { ApiError } from "../common/api-error";
import { db } from "../db/client";
import { apiKeys } from "../db/schema/api-keys";
import { auth } from "./auth";

declare module "express" {
  interface Request {
    userId: string;
  }
}

@Injectable()
export class CurrentUserGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      const token = authorization.slice("Bearer ".length).trim();
      if (token.startsWith("nx_live_")) {
        const keyHash = createHash("sha256").update(token).digest("hex");
        const key = await db.query.apiKeys.findFirst({
          where: and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)),
        });
        if (key) {
          request.userId = key.userId;
          void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id)).catch(() => undefined);
          return true;
        }
      }
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new ApiError(401, "Not authenticated");
    request.userId = session.user.id;
    return true;
  }
}
