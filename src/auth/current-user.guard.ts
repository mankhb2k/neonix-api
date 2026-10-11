import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { ApiError } from "../common/api-error";
import { env } from "../env";
import { auth } from "./auth";
import { ensureDevUser } from "./dev-auth";

declare module "express" {
  interface Request {
    userId: string;
  }
}

@Injectable()
export class CurrentUserGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const devUser = env.devAuthBypass ? request.headers["x-dev-user"] : undefined;
    if (typeof devUser === "string" && /^[\w.-]{3,60}$/.test(devUser)) {
      const role = request.headers["x-dev-role"];
      await ensureDevUser(devUser, typeof role === "string" ? role : undefined);
      request.userId = devUser;
      return true;
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new ApiError(401, "Not authenticated");
    request.userId = session.user.id;
    return true;
  }
}
