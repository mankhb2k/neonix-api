import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { db } from "../db/client";
import { DatabaseModule } from "../db/database.module";
import { assets } from "../db/schema/assets";
import { accountPlans } from "../db/schema/identity";
import { R2Service } from "../r2/r2.service";
import { seedUserGuard } from "../test/seed-user-guard";
import { AssetsModule } from "./assets.module";

const seedWorkspaceId = process.env.SEED_WORKSPACE_ID!;
const seedUserId = process.env.SEED_USER_ID!;
const createdAssetIds: string[] = [];
const uploadedR2Keys: string[] = [];
let app: INestApplication;
let r2: R2Service;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, AssetsModule] })
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
  if (createdAssetIds.length > 0) await db.delete(assets).where(inArray(assets.id, createdAssetIds));
  await app.close();
});

describe("assets routes (Nest, real Neon dev DB + real R2 bucket)", () => {
  it("uploads real bytes to R2 through a presigned URL and completes the asset", async () => {
    const fileContents = Buffer.from("hello from the neonix Nest R2 smoke test\n", "utf8");

    const requestResponse = await request(app.getHttpServer())
      .post("/v1/assets/upload-requests")
      .send({ workspaceId: seedWorkspaceId, mimeType: "text/plain", byteSize: fileContents.byteLength });
    expect(requestResponse.status).toBe(201);
    const { asset, uploadUrl, headers } = requestResponse.body;
    expect(asset.status).toBe("uploading");
    createdAssetIds.push(asset.id);
    uploadedR2Keys.push(asset.r2Key);

    const putResponse = await fetch(uploadUrl, { method: "PUT", headers, body: fileContents });
    expect(putResponse.ok).toBe(true);

    const completeResponse = await request(app.getHttpServer()).post(`/v1/assets/${asset.id}/complete`);
    expect(completeResponse.status).toBe(200);
    expect(completeResponse.body.asset.status).toBe("ready");
    expect(completeResponse.body.asset.byteSize).toBe(fileContents.byteLength);

    const roundTrip = await r2.getObject("R2_USER_ASSETS_BUCKET", asset.r2Key);
    expect(roundTrip?.toString("utf8")).toBe(fileContents.toString("utf8"));

    const getResponse = await request(app.getHttpServer()).get(`/v1/assets/${asset.id}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.asset.status).toBe("ready");
  });

  it("404s completing an asset with nothing uploaded to its R2 key", async () => {
    const requestResponse = await request(app.getHttpServer())
      .post("/v1/assets/upload-requests")
      .send({ workspaceId: seedWorkspaceId, mimeType: "text/plain", byteSize: 10 });
    createdAssetIds.push(requestResponse.body.asset.id);

    const completeResponse = await request(app.getHttpServer()).post(`/v1/assets/${requestResponse.body.asset.id}/complete`);
    expect(completeResponse.status).toBe(422);
    expect(completeResponse.body.error.code).toBe("upload_not_found");
  });

  it("lists and soft-deletes an asset", async () => {
    const requestResponse = await request(app.getHttpServer())
      .post("/v1/assets/upload-requests")
      .send({ workspaceId: seedWorkspaceId, mimeType: "text/plain", byteSize: 4 });
    const assetId = requestResponse.body.asset.id;
    createdAssetIds.push(assetId);
    uploadedR2Keys.push(requestResponse.body.asset.r2Key);
    await fetch(requestResponse.body.uploadUrl, { method: "PUT", headers: requestResponse.body.headers, body: "test" });
    await request(app.getHttpServer()).post(`/v1/assets/${assetId}/complete`);

    const listResponse = await request(app.getHttpServer()).get(`/v1/assets?workspaceId=${seedWorkspaceId}`);
    expect(listResponse.body.assets.map((a: { id: string }) => a.id)).toContain(assetId);

    const deleteResponse = await request(app.getHttpServer()).delete(`/v1/assets/${assetId}`);
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.asset.status).toBe("deleted");

    const goneResponse = await request(app.getHttpServer()).get(`/v1/assets/${assetId}`);
    expect(goneResponse.status).toBe(404);
  });

  it("streams a real asset's bytes via /media, including Range support", async () => {
    const fileContents = Buffer.from("0123456789abcdefghij", "utf8");
    const requestResponse = await request(app.getHttpServer())
      .post("/v1/assets/upload-requests")
      .send({ workspaceId: seedWorkspaceId, mimeType: "text/plain", byteSize: fileContents.byteLength });
    const asset = requestResponse.body.asset;
    createdAssetIds.push(asset.id);
    uploadedR2Keys.push(asset.r2Key);
    await fetch(requestResponse.body.uploadUrl, { method: "PUT", headers: requestResponse.body.headers, body: fileContents });
    await request(app.getHttpServer()).post(`/v1/assets/${asset.id}/complete`);

    const full = await request(app.getHttpServer()).get(`/v1/assets/${asset.id}/media`);
    expect(full.status).toBe(200);
    // R2 reports back whatever Content-Type it stored for the upload, which
    // may include a charset suffix (e.g. "text/plain; charset=utf-8") - the
    // route correctly passes through whatever R2 says, so assert on the
    // semantic type rather than a byte-exact string.
    expect(full.headers["content-type"]).toMatch(/^text\/plain/);
    expect(full.headers["content-length"]).toBe(String(fileContents.byteLength));
    expect(full.text).toBe(fileContents.toString("utf8"));

    const partial = await request(app.getHttpServer())
      .get(`/v1/assets/${asset.id}/media`)
      .set("Range", "bytes=0-4");
    expect(partial.status).toBe(206);
    expect(partial.headers["content-range"]).toBe(`bytes 0-4/${fileContents.byteLength}`);
    expect(partial.text).toBe("01234");

    const invalidRange = await request(app.getHttpServer())
      .get(`/v1/assets/${asset.id}/media`)
      .set("Range", `bytes=${fileContents.byteLength + 10}-${fileContents.byteLength + 20}`);
    expect(invalidRange.status).toBe(416);
  });

  it("404s poster/audio variants before the media pipeline has populated them", async () => {
    const requestResponse = await request(app.getHttpServer())
      .post("/v1/assets/upload-requests")
      .send({ workspaceId: seedWorkspaceId, mimeType: "video/mp4", byteSize: 4 });
    const asset = requestResponse.body.asset;
    createdAssetIds.push(asset.id);
    uploadedR2Keys.push(asset.r2Key);
    await fetch(requestResponse.body.uploadUrl, { method: "PUT", headers: requestResponse.body.headers, body: "test" });
    await request(app.getHttpServer()).post(`/v1/assets/${asset.id}/complete`);

    const poster = await request(app.getHttpServer()).get(`/v1/assets/${asset.id}/media?variant=poster`);
    expect(poster.status).toBe(404);

    const audio = await request(app.getHttpServer()).get(`/v1/assets/${asset.id}/media?variant=audio`);
    expect(audio.status).toBe(404);
  });

  it("404s /media for another workspace's asset (viewer-role check)", async () => {
    const response = await request(app.getHttpServer()).get("/v1/assets/00000000-0000-0000-0000-000000000000/media");
    expect(response.status).toBe(404);
  });

  describe("storage quota enforcement", () => {
    beforeAll(async () => {
      await db.update(accountPlans).set({ maxUploadBytes: 5 }).where(eq(accountPlans.id, seedUserId));
    });

    afterAll(async () => {
      await db.update(accountPlans).set({ maxUploadBytes: 524288000 }).where(eq(accountPlans.id, seedUserId));
    });

    it("rejects a per-file upload larger than the plan's max_upload_bytes", async () => {
      const response = await request(app.getHttpServer())
        .post("/v1/assets/upload-requests")
        .send({ workspaceId: seedWorkspaceId, mimeType: "text/plain", byteSize: 1000 });
      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe("upload_too_large");
    });
  });
});
