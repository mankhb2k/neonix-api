import { randomUUID } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { db } from "../db/client";
import { DatabaseModule } from "../db/database.module";
import { projects } from "../db/schema/projects";
import { seedUserGuard } from "../test/seed-user-guard";
import { ProjectsModule } from "./projects.module";

const seedWorkspaceId = process.env.SEED_WORKSPACE_ID!;
const seedUserId = process.env.SEED_USER_ID!;
let app: INestApplication;

const RAW_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="neonix-document" content='{"kind":"neonix-html-document","schemaVersion":2,"composition":{"width":1080,"height":1920,"fps":30,"background":"#000000","colorSpace":"srgb"}}' />
    <title>HTML Test</title>
    <style>.label { color: #ffffff; font-family: Inter, sans-serif; font-weight: 400; }</style>
  </head>
  <body style="margin:0;width:1080px;height:1920px;background:#000000;">
    <div class="label">hello</div>
  </body>
</html>`;

// This file's tests each create their own project(s) in the shared seed
// workspace, which has a real active-project-limit (see quotas.service.ts) -
// running alongside every other test file's own project-creating tests in
// parallel can transiently exceed it. Delete each test's project(s)
// immediately once done, rather than batching into afterAll, to keep this
// file's peak footprint in the shared workspace as small as possible.
async function deleteProjects(...ids: string[]) {
  const real = ids.filter(Boolean);
  if (real.length > 0) await db.delete(projects).where(inArray(projects.id, real));
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, ProjectsModule] })
    .overrideGuard(CurrentUserGuard)
    .useValue(seedUserGuard(seedUserId))
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe("HTML project routes (Nest, real Neon dev DB)", () => {
  it("creates an HTML project", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/projects/html-raw")
      .send({ workspaceId: seedWorkspaceId, html: RAW_HTML });
    try {
      expect(response.status).toBe(201);
      expect(response.body.project.title).toBe("HTML Test");
    } finally {
      await deleteProjects(response.body.project?.id);
    }
  });

  it("rejects raw HTML missing the composition meta tag", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/projects/html-raw")
      .send({ workspaceId: seedWorkspaceId, html: "<html><body>no meta</body></html>" });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("html-document-metadata-missing");
  });

  it("is idempotent on create_idempotency_key", async () => {
    const idempotencyKey = `test-html-${randomUUID().slice(0, 8)}`;
    const first = await request(app.getHttpServer())
      .post("/v1/projects/html-raw")
      .send({ workspaceId: seedWorkspaceId, html: RAW_HTML, idempotencyKey });
    try {
      expect(first.status).toBe(201);
      expect(first.body.alreadyCreated).toBe(false);

      const second = await request(app.getHttpServer())
        .post("/v1/projects/html-raw")
        .send({ workspaceId: seedWorkspaceId, html: RAW_HTML, idempotencyKey });
      expect(second.status).toBe(201);
      expect(second.body.alreadyCreated).toBe(true);
      expect(second.body.project.id).toBe(first.body.project.id);
    } finally {
      await deleteProjects(first.body.project?.id);
    }
  });

  it("gets and overwrites the current HTML document with no revision history", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/projects/html-raw")
      .send({ workspaceId: seedWorkspaceId, html: RAW_HTML });
    const projectId = created.body.project.id as string;
    try {
      const got = await request(app.getHttpServer()).get(`/v1/projects/${projectId}/html`);
      expect(got.status).toBe(200);
      expect(got.body.html).toBe(RAW_HTML);

      const updatedHtml = RAW_HTML.replace("hello", "updated");
      const put = await request(app.getHttpServer())
        .put(`/v1/projects/${projectId}/html`)
        .send({ html: updatedHtml });
      expect(put.status).toBe(200);
      expect(put.body.html).toBe(updatedHtml);

      const gotAfter = await request(app.getHttpServer()).get(`/v1/projects/${projectId}/html`);
      expect(gotAfter.body.html).toBe(updatedHtml);
    } finally {
      await deleteProjects(projectId);
    }
  });
});
