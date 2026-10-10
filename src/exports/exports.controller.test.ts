import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { db } from "../db/client";
import { DatabaseModule } from "../db/database.module";
import { projectHtmlDocuments, projects } from "../db/schema/projects";
import { htmlRenderJobs } from "../db/schema/render";
import { seedUserGuard } from "../test/seed-user-guard";
import { ExportsModule } from "./exports.module";

const seedWorkspaceId = process.env.SEED_WORKSPACE_ID!;
const seedUserId = process.env.SEED_USER_ID!;
let app: INestApplication;
let projectId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, ExportsModule] })
    .overrideGuard(CurrentUserGuard)
    .useValue(seedUserGuard(seedUserId))
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  const [project] = await db
    .insert(projects)
    .values({ workspaceId: seedWorkspaceId, title: "Exports test project", createdBy: seedUserId })
    .returning();
  projectId = project!.id;
  await db.insert(projectHtmlDocuments).values({
    projectId,
    html: "<html></html>",
    contentHash: "x",
    byteSize: 13,
    createdBy: seedUserId,
  });
  await db.insert(htmlRenderJobs).values([
    { workspaceId: seedWorkspaceId, projectId, createdBy: seedUserId, status: "done", durationMs: 60_000, costVnd: 1200, outputKey: "k.mp4" },
    { workspaceId: seedWorkspaceId, projectId, createdBy: seedUserId, status: "failed", errorMessage: "boom" },
  ]);
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
  await app.close();
});

describe("exports routes (Nest, real Neon dev DB)", () => {
  it("lists the workspace's exports with the project title", async () => {
    const response = await request(app.getHttpServer()).get(`/v1/exports?workspaceId=${seedWorkspaceId}`);
    expect(response.status).toBe(200);
    const mine = response.body.exports.filter((item: { projectId: string }) => item.projectId === projectId);
    expect(mine).toHaveLength(2);
    expect(mine[0].projectTitle).toBe("Exports test project");
    expect(mine.map((item: { status: string }) => item.status).sort()).toEqual(["done", "failed"]);
  });

  it("summarises only finished exports and returns a 14-day trend", async () => {
    const response = await request(app.getHttpServer()).get(`/v1/exports/summary?workspaceId=${seedWorkspaceId}`);
    expect(response.status).toBe(200);
    expect(response.body.exportedCount).toBeGreaterThanOrEqual(1);
    expect(response.body.totalDurationMs).toBeGreaterThanOrEqual(60_000);
    expect(response.body.daily).toHaveLength(14);
    expect(response.body.daily.at(-1).count).toBeGreaterThanOrEqual(1);
    expect(response.body.projectLimit).toBeGreaterThan(0);
  });

  it("requires a workspaceId and a valid export id", async () => {
    expect((await request(app.getHttpServer()).get("/v1/exports")).status).toBe(400);
    expect((await request(app.getHttpServer()).get("/v1/exports/not-a-uuid/download")).status).toBe(400);
  });
});
