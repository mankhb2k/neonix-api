import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { toNodeHandler } from "better-auth/node";
import express from "express";
import { AppModule } from "./app.module";
import { auth } from "./auth/auth";
import { env } from "./env";

async function bootstrap() {
  // bodyParser off: Better Auth must read its own raw body, so it is mounted
  // before express.json().
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance.all("/api/auth/*splat", toNodeHandler(auth));
  app.use(express.json());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Neonix API")
    .setDescription("Accounts, credits, templates and export authorization.")
    .setVersion("2.0")
    .addBearerAuth()
    // Dev only: Swagger UI cannot set arbitrary headers, so expose the dev-login headers as Authorize fields.
    .addApiKey({ type: "apiKey", in: "header", name: "X-Dev-User", description: "DEV_AUTH_BYPASS: act as this user (any id, e.g. dev-ios)" }, "dev-user")
    .addApiKey({ type: "apiKey", in: "header", name: "X-Dev-Role", description: "DEV_AUTH_BYPASS: user | creator | admin" }, "dev-role")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  if (!env.devAuthBypass) {
    delete document.components?.securitySchemes?.["dev-user"];
    delete document.components?.securitySchemes?.["dev-role"];
  } else {
    // Operation-level `security` (from @ApiBearerAuth) overrides global, so add the dev schemes to each operation.
    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations as Record<string, { security?: Record<string, string[]>[] }>)) {
        if (operation.security) operation.security = [...operation.security, { "dev-user": [] }, { "dev-role": [] }];
      }
    }
  }
  SwaggerModule.setup("docs", app, document, { swaggerOptions: { persistAuthorization: true } });

  await app.listen(env.port);
  console.log(`[api] listening on :${env.port}`);
}

void bootstrap();
