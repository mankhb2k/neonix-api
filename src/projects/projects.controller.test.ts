import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssetsModule } from "../assets/assets.module";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { db } from "../db/client";
import { DatabaseModule } from "../db/database.module";
import { accountPlans } from "../db/schema/identity";
import { R2Service } from "../r2/r2.service";
import { seedUserGuard } from "../test/seed-user-guard";
import { ProjectsModule } from "./projects.module";

const RAW_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="neonix-document" content='{"kind":"neonix-html-document","schemaVersion":2,"composition":{"width":1080,"height":1920,"fps":30,"background":"#000000","colorSpace":"srgb"}}' />
    <title>Project test</title>
  </head>
  <body style="margin:0;width:1080px;height:1920px;background:#000000;">
    <div>hello</div>
  </body>
</html>`;

const seedWorkspaceId = process.env.SEED_WORKSPACE_ID!;
const seedUserId = process.env.SEED_USER_ID!;
const createdProjectIds: string[] = [];
const uploadedR2Keys: string[] = [];
let app: INestApplication;
let r2: R2Service;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, ProjectsModule, AssetsModule] })
    .overrideGuard(CurrentUserGuard)
    .useValue(seedUserGuard(seedUserId))
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  r2 = moduleRef.get(R2Service);
});

afterAll(async () => {
  for (const key of uploadedR2Keys) await r2.deleteObject("R2_USER_ASSETS_BUCKET", key).catch(() => undefined);
  for (const id of createdProjectIds) {
    await request(app.getHttpServer()).delete(`/v1/projects/${id}`);
  }
  await app.close();
});

describe("projects routes (Nest, real Neon dev DB)", () => {
  it("creates a project in the seed workspace", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/projects/html-raw")
      .send({ workspaceId: seedWorkspaceId, html: RAW_HTML, title: "Phase 3 Nest test project" });
    expect(response.status).toBe(201);
    expect(response.body.project.title).toBe("Phase 3 Nest test project");
    createdProjectIds.push(response.body.project.id);
  });

  it("lists the created project", async () => {
    const response = await request(app.getHttpServer()).get(`/v1/projects?workspaceId=${seedWorkspaceId}`);
    expect(response.status).toBe(200);
    const ids = response.body.projects.map((p: { id: string }) => p.id);
    expect(ids).toContain(createdProjectIds[0]);
  });

  it("updates a project's title", async () => {
    const response = await request(app.getHttpServer())
      .patch(`/v1/projects/${createdProjectIds[0]}`)
      .send({ title: "Renamed project" });
    expect(response.status).toBe(200);
    expect(response.body.project.title).toBe("Renamed project");
  });

  it("soft-deletes then restores a project", async () => {
    const deleted = await request(app.getHttpServer()).delete(`/v1/projects/${createdProjectIds[0]}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.project.deletedAt).not.toBeNull();

    const goneFromGet = await request(app.getHttpServer()).get(`/v1/projects/${createdProjectIds[0]}`);
    expect(goneFromGet.status).toBe(404);

    const restored = await request(app.getHttpServer()).post(`/v1/projects/${createdProjectIds[0]}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.project.deletedAt).toBeNull();

    const backFromGet = await request(app.getHttpServer()).get(`/v1/projects/${createdProjectIds[0]}`);
    expect(backFromGet.status).toBe(200);
  });

  describe("active project count limit", () => {
    let previousMaxActiveProjects: number;

    beforeAll(async () => {
      const plan = await db.query.accountPlans.findFirst({ where: eq(accountPlans.id, seedUserId) });
      previousMaxActiveProjects = plan!.maxActiveProjects;
      await db.update(accountPlans).set({ maxActiveProjects: 1 }).where(eq(accountPlans.id, seedUserId));
    });

    afterAll(async () => {
      // Restore whatever it actually was, not a hardcoded value - the
      // shared seed workspace's active-project quota may be raised
      // independently of this test (see [[pitfall...]] project memory on
      // parallel test-file quota contention).
      await db.update(accountPlans).set({ maxActiveProjects: previousMaxActiveProjects }).where(eq(accountPlans.id, seedUserId));
    });

    it("rejects creating a project once the plan's active-project limit is reached", async () => {
      const response = await request(app.getHttpServer())
        .post("/v1/projects/html-raw")
        .send({ workspaceId: seedWorkspaceId, html: RAW_HTML, title: "Over the limit" });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("project_limit_reached");
    });
  });

  describe("project-asset linking", () => {
    // Immediate per-test cleanup (soft-delete right away, not via the
    // shared createdProjectIds+afterAll) - keeps this describe block's
    // contribution to the shared workspace's active-project quota minimal
    // while other project-creating test files run in parallel.
    it("attaches a real asset to a project (idempotent) and reports usage from the asset side", async () => {
      const uploadRequest = await request(app.getHttpServer())
        .post("/v1/assets/upload-requests")
        .send({ workspaceId: seedWorkspaceId, mimeType: "text/plain", byteSize: 4 });
      const asset = uploadRequest.body.asset;
      uploadedR2Keys.push(asset.r2Key);
      await fetch(uploadRequest.body.uploadUrl, { method: "PUT", headers: uploadRequest.body.headers, body: "test" });
      await request(app.getHttpServer()).post(`/v1/assets/${asset.id}/complete`);

      const projectResponse = await request(app.getHttpServer())
        .post("/v1/projects/html-raw")
        .send({ workspaceId: seedWorkspaceId, html: RAW_HTML, title: "Asset link test project" });
      const projectId = projectResponse.body.project.id;

      try {
        const attach = await request(app.getHttpServer()).post(`/v1/projects/${projectId}/assets`).send({ assetId: asset.id });
        expect(attach.status).toBe(200);
        expect(attach.body.ok).toBe(true);

        // Idempotent - attaching the same asset again is a no-op, not an error.
        const attachAgain = await request(app.getHttpServer()).post(`/v1/projects/${projectId}/assets`).send({ assetId: asset.id });
        expect(attachAgain.status).toBe(200);

        const usage = await request(app.getHttpServer()).get(`/v1/assets/${asset.id}/usage`);
        expect(usage.status).toBe(200);
        expect(usage.body.assetId).toBe(asset.id);
        expect(usage.body.projects).toHaveLength(1);
        expect(usage.body.projects[0]).toMatchObject({ id: projectId, title: "Asset link test project" });
      } finally {
        await request(app.getHttpServer()).delete(`/v1/projects/${projectId}`);
        await request(app.getHttpServer()).delete(`/v1/assets/${asset.id}`);
      }
    });

    it("404s attaching an asset from a different workspace's asset id", async () => {
      const projectResponse = await request(app.getHttpServer())
        .post("/v1/projects/html-raw")
        .send({ workspaceId: seedWorkspaceId, html: RAW_HTML, title: "Attach reject test project" });
      const projectId = projectResponse.body.project.id;

      try {
        const response = await request(app.getHttpServer())
          .post(`/v1/projects/${projectId}/assets`)
          .send({ assetId: "00000000-0000-0000-0000-000000000000" });
        expect(response.status).toBe(404);
      } finally {
        await request(app.getHttpServer()).delete(`/v1/projects/${projectId}`);
      }
    });

    it("returns an empty usage list for an asset attached to nothing", async () => {
      const uploadRequest = await request(app.getHttpServer())
        .post("/v1/assets/upload-requests")
        .send({ workspaceId: seedWorkspaceId, mimeType: "text/plain", byteSize: 4 });
      const asset = uploadRequest.body.asset;
      uploadedR2Keys.push(asset.r2Key);
      await fetch(uploadRequest.body.uploadUrl, { method: "PUT", headers: uploadRequest.body.headers, body: "test" });
      await request(app.getHttpServer()).post(`/v1/assets/${asset.id}/complete`);

      try {
        const usage = await request(app.getHttpServer()).get(`/v1/assets/${asset.id}/usage`);
        expect(usage.status).toBe(200);
        expect(usage.body.projects).toEqual([]);
      } finally {
        await request(app.getHttpServer()).delete(`/v1/assets/${asset.id}`);
      }
    });
  });
});
