import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { db } from "../db/client";
import { DatabaseModule } from "../db/database.module";
import { auditEvents } from "../db/schema/misc";
import { seedUserGuard } from "../test/seed-user-guard";
import { AuditEventsModule } from "./audit-events.module";

const seedWorkspaceId = process.env.SEED_WORKSPACE_ID!;
const seedUserId = process.env.SEED_USER_ID!;
const createdEventIds: number[] = [];
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, AuditEventsModule] })
    .overrideGuard(CurrentUserGuard)
    .useValue(seedUserGuard(seedUserId))
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
});

afterAll(async () => {
  for (const id of createdEventIds) await db.delete(auditEvents).where(eq(auditEvents.id, id));
  await app.close();
});

describe("audit-events routes (Nest, real Neon dev DB)", () => {
  it("logs an event, forcing actorUserId to the current user regardless of the request body", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/audit-events")
      .send({
        workspaceId: seedWorkspaceId,
        action: "project.created",
        targetType: "project",
        actorUserId: "someone-else-entirely",
        metadataJson: { title: "Test project" },
      });
    expect(response.status).toBe(201);
    expect(response.body.auditEvent.actorUserId).toBe(seedUserId);
    expect(response.body.auditEvent.action).toBe("project.created");
    createdEventIds.push(response.body.auditEvent.id);
  });

  it("lists events for a workspace, newest first", async () => {
    const second = await request(app.getHttpServer())
      .post("/v1/audit-events")
      .send({ workspaceId: seedWorkspaceId, action: "project.renamed" });
    createdEventIds.push(second.body.auditEvent.id);

    const listResponse = await request(app.getHttpServer()).get(`/v1/audit-events?workspaceId=${seedWorkspaceId}`);
    expect(listResponse.status).toBe(200);
    const ids = listResponse.body.auditEvents.map((e: { id: number }) => e.id);
    expect(ids.indexOf(second.body.auditEvent.id)).toBeLessThan(ids.indexOf(createdEventIds[0]));
  });

  it("404s for a workspace the current user isn't a member of", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/audit-events")
      .send({ workspaceId: "00000000-0000-0000-0000-000000000000", action: "x" });
    expect(response.status).toBe(404);
  });
});
