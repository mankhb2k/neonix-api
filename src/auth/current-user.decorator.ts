import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

// Pulls the userId the CurrentUserGuard already attached to the request -
// controllers write `@CurrentUser() userId: string` instead of reaching
// into `req.userId` by hand.
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return request.userId;
});
