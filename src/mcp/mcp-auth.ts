import type { RemoteMcpPrincipal } from "@motionvideo/motion-mcp/remote";
import type { JWTPayload } from "jose";

/**
 * Maps a verified MCP access-token payload (from `requireMcpAuth`, see
 * mount-mcp.ts) onto the principal shape `createRemoteMcpServer` expects.
 * `sub`/`azp`/`scope` are the standard OAuth/OIDC claim names Better Auth's
 * OAuth 2.1 provider (`@better-auth/mcp`) issues - see auth.ts's `mcp()`
 * plugin config.
 */
export function mcpPrincipalFromClaims(request: Request, claims: JWTPayload): RemoteMcpPrincipal {
  const userId = claims.sub?.trim();
  if (!userId) throw new Error("Access token is missing a subject (user id) claim");
  const clientId = typeof claims.azp === "string" && claims.azp ? claims.azp : "unknown-client";
  const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return { userId, clientId, scopes, token, expiresAt: claims.exp };
}
