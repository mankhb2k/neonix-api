import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { toNodeHandler } from "better-auth/node";
import express from "express";
import { auth } from "./auth/auth";
import { AppModule } from "./app.module";
import { env } from "./env";
import { mountMcp } from "./mcp/mount-mcp";

async function bootstrap() {
  // bodyParser disabled: Better Auth needs the raw, unparsed request to
  // read/write its own body - mounted directly on the underlying Express
  // instance before express.json() (added back further down) so no
  // body-parsing middleware touches those paths first.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Cross-subdomain session cookies (api.neonix.video <-> app.neonix.video)
  // only reach the browser if the API echoes back a matching CORS origin
  // with credentials allowed - the default Nest/Express behavior sends no
  // Access-Control-Allow-Origin at all, which silently drops the cookie.
  app.enableCors({
    origin: [env.webAppUrl, ...env.additionalTrustedOrigins],
    credentials: true,
  });
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance.all("/api/auth/*splat", toNodeHandler(auth));
  // @better-auth/mcp's protected-resource metadata (RFC 9728) is served by an
  // `onRequest` hook that matches the request's raw pathname against
  // `/.well-known/oauth-protected-resource[/mcp]` with no basePath prefix
  // awareness (unlike ordinary Better Auth endpoints, which Better Auth's
  // own router prefixes with /api/auth automatically) - it only fires when
  // reachable at the literal site root, so it needs its own mount here.
  // Authorization-server metadata itself is unaffected: its issuer is
  // `${BETTER_AUTH_URL}/api/auth`, so clients resolve it correctly under the
  // normal mount above.
  const mcpAuthHandler = toNodeHandler(auth);
  expressInstance.all("/.well-known/oauth-protected-resource", mcpAuthHandler);
  expressInstance.all("/.well-known/oauth-protected-resource/mcp", mcpAuthHandler);
  // Polar's webhook signature covers the exact raw bytes it sent - mounted
  // before express.json() for this one path, same reasoning as Better Auth
  // above. See billing/webhooks.controller.ts.
  expressInstance.post("/webhooks/polar", express.raw({ type: "application/json" }));
  // The MCP transport reads the raw request stream itself (via
  // @whatwg-node/server's Node-req-to-Fetch-Request bridge) - mounted before
  // express.json() for the same reason as the two mounts above, otherwise
  // the global JSON parser would drain the stream first and every MCP
  // JSON-RPC request would arrive with an empty body.
  mountMcp(app, expressInstance);
  app.use(express.json());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Neonix API")
    .setDescription("Neonix API endpoints for projects, assets, billing, and API keys.")
    .setVersion("1.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "Neonix API key" },
      "api-key",
    )
    .addCookieAuth("better-auth.session_token", undefined, "session")
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, swaggerDocument, {
    jsonDocumentUrl: "docs-json",
    yamlDocumentUrl: "docs-yaml",
    swaggerOptions: {
      displayRequestDuration: true,
      persistAuthorization: true,
    },
  });

  await app.listen(env.port);
  console.log(`[api] listening on :${env.port}`);
}

void bootstrap();
