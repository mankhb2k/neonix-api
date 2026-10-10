import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/**
 * Stands in for a real Better Auth session in HTTP-layer controller tests:
 * stamps the seed user onto the request exactly like `CurrentUserGuard`
 * would after a real session lookup, without needing a live sign-in round
 * trip (email/password or Google) in every test file.
 */
export function seedUserGuard(userId: string): CanActivate {
  return {
    canActivate(context: ExecutionContext): boolean {
      context.switchToHttp().getRequest<Request>().userId = userId;
      return true;
    },
  };
}
