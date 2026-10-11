import { CanActivate, ExecutionContext, Inject, Injectable, mixin, type Type } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import { ApiError } from "../common/api-error";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { profiles } from "../db/schema/profile";

type Role = "user" | "creator" | "admin";

// Use after CurrentUserGuard: `@UseGuards(CurrentUserGuard, RolesGuard("creator", "admin"))`.
export function RolesGuard(...allowed: Role[]): Type<CanActivate> {
  @Injectable()
  class RolesGuardImpl implements CanActivate {
    constructor(@Inject(DATABASE) private readonly db: Database) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const { userId } = context.switchToHttp().getRequest<Request>();
      const profile = await this.db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
      if (!profile || !allowed.includes(profile.role)) throw new ApiError(403, "Forbidden");
      return true;
    }
  }
  return mixin(RolesGuardImpl);
}
