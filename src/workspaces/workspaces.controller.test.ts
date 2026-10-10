import { randomUUID } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { DatabaseModule } from "../db/database.module";
import { seedUserGuard } from "../test/seed-user-guard";
import { WorkspacesModule } from "./workspaces.module";

const seedWorkspaceId = process.env.SEED_WORKSPACE_ID!;
const seedUserId = process.env.SEED_USER_ID!;
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [DatabaseModule, WorkspacesModule],
  })
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

describe("workspaces routes (Nest, real Neon dev DB)", () => {
  it("lists the seed workspace for the current (stubbed) user", async () => {
    const response = await request(app.getHttpServer()).get("/v1/workspaces");
    expect(response.status).toBe(200);
    const ids = response.body.workspaces.map((w: { id: string }) => w.id);
    expect(ids).toContain(seedWorkspaceId);
  });

  it("gets a workspace the user is a member of", async () => {
    const response = await request(app.getHttpServer()).get(`/v1/workspaces/${seedWorkspaceId}`);
    expect(response.status).toBe(200);
    expect(response.body.workspace.id).toBe(seedWorkspaceId);
  });

  it("404s for a workspace the user is not a member of", async () => {
    const response = await request(app.getHttpServer()).get(`/v1/workspaces/${randomUUID()}`);
    expect(response.status).toBe(404);
  });

  it("renames a workspace and persists it", async () => {
    const original = await request(app.getHttpServer()).get(`/v1/workspaces/${seedWorkspaceId}`);
    const originalName = original.body.workspace.name as string;

    const renamed = await request(app.getHttpServer())
      .patch(`/v1/workspaces/${seedWorkspaceId}`)
      .send({ name: "Renamed Seed Workspace" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.workspace.name).toBe("Renamed Seed Workspace");

    const reread = await request(app.getHttpServer()).get(`/v1/workspaces/${seedWorkspaceId}`);
    expect(reread.body.workspace.name).toBe("Renamed Seed Workspace");

    await request(app.getHttpServer()).patch(`/v1/workspaces/${seedWorkspaceId}`).send({ name: originalName });
  });

  it("rejects an empty name", async () => {
    const response = await request(app.getHttpServer()).patch(`/v1/workspaces/${seedWorkspaceId}`).send({ name: "" });
    expect(response.status).toBe(400);
  });
});
