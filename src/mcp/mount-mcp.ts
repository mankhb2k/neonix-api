import { requireMcpAuth } from "@better-auth/mcp";
import { createRemoteMcpServer } from "@motionvideo/motion-mcp/remote";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { INestApplication } from "@nestjs/common";
import { createServerAdapter } from "@whatwg-node/server";
import type { Express } from "express";
import type { JWTPayload } from "jose";
import { AssetsService } from "../assets/assets.service";
import { auth } from "../auth/auth";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { env } from "../env";
import { ProjectsService } from "../projects/projects.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { buildMcpProjectApi } from "./mcp-api";
import { mcpPrincipalFromClaims } from "./mcp-auth";

// Mounted directly on the raw Express instance, same reasoning as Better
// Auth's toNodeHandler mount in main.ts: the MCP SDK's Streamable HTTP
// transport speaks Web-standard Request/Response, not Nest's controller
// model, so there's nothing for a Nest controller to add here. Services are
// resolved once at boot via app.get() (they're stateless singletons) and
// closed over per-request rather than re-resolved on every call.
export function mountMcp(app: INestApplication, expressInstance: Express): void {
  const db = app.get<Database>(DATABASE);
  const workspaces = app.get(WorkspacesService);
  const projects = app.get(ProjectsService);
  const assets = app.get(AssetsService);

  const mcpHandler = async (request: Request, claims: JWTPayload): Promise<Response> => {
    const principal = mcpPrincipalFromClaims(request, claims);
    const api = buildMcpProjectApi(
      { db, workspaces, projects, assets, webAppUrl: env.webAppUrl },
      principal.userId,
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createRemoteMcpServer({ api, principal });
    await server.connect(transport);
    return transport.handleRequest(request, {
      authInfo: {
        token: principal.token,
        clientId: principal.clientId,
        scopes: principal.scopes,
        expiresAt: principal.expiresAt,
        resource: new URL(request.url),
        extra: { userId: principal.userId },
      },
    });
  };

  // Verifies the bearer access token against auth.ts's `mcp()` provider
  // (issuer/JWKS/audience all default to the resolved baseURL + this
  // `resource`) before every request reaches the MCP transport - replaces
  // the former SEED_USER_ID stub now that Google login + the OAuth 2.1
  // provider are wired up.
  const protectedHandler = requireMcpAuth(auth, mcpHandler, { resource: `${env.betterAuthUrl}/mcp` });
  expressInstance.use("/mcp", createServerAdapter(protectedHandler));
}
