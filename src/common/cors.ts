import type { NextFunction, Request, Response } from "express";

/**
 * CORS for the Neonix website (cookie sessions, so credentials are allowed). Only the listed origins get the
 * headers; everything else is left to the browser to refuse. Runs before Better Auth so /api/auth/* is covered too.
 */
export function corsMiddleware(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.headers.origin;
    if (origin && allowed.has(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.vary("Origin");
      if (request.method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
        response.setHeader(
          "Access-Control-Allow-Headers",
          (request.headers["access-control-request-headers"] as string | undefined) ?? "Content-Type,Authorization",
        );
        response.setHeader("Access-Control-Max-Age", "600");
        response.status(204).end();
        return;
      }
    }
    next();
  };
}
