import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { db } from "../db/client";
import { DatabaseModule } from "../db/database.module";
import { assets } from "../db/schema/assets";
import { userFontFamilies } from "../db/schema/fonts";
import { projects } from "../db/schema/projects";
import { R2Service } from "../r2/r2.service";
import { AssetsModule } from "../assets/assets.module";
import { ProjectsModule } from "../projects/projects.module";
import { seedUserGuard } from "../test/seed-user-guard";
import { FontsModule } from "./fonts.module";

const seedWorkspaceId = process.env.SEED_WORKSPACE_ID!;
const seedUserId = process.env.SEED_USER_ID!;
const createdFamilyIds: string[] = [];
const createdAssetIds: string[] = [];
const createdProjectIds: string[] = [];
const uploadedR2Keys: string[] = [];
let app: INestApplication;
let r2: R2Service;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [DatabaseModule, FontsModule, AssetsModule, ProjectsModule],
  })
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
  if (createdProjectIds.length > 0) await db.delete(projects).where(inArray(projects.id, createdProjectIds));
  if (createdFamilyIds.length > 0) await db.delete(userFontFamilies).where(inArray(userFontFamilies.id, createdFamilyIds));
  if (createdAssetIds.length > 0) await db.delete(assets).where(inArray(assets.id, createdAssetIds));
  await app.close();
});

async function uploadRealAsset(kind: "font" | "image", mimeType: string, contents: string) {
  const body = Buffer.from(contents, "utf8");
  const requestResponse = await request(app.getHttpServer())
    .post("/v1/assets/upload-requests")
    .send({ workspaceId: seedWorkspaceId, mimeType, byteSize: body.byteLength, kind });
  const { asset, uploadUrl, headers } = requestResponse.body;
  createdAssetIds.push(asset.id);
  uploadedR2Keys.push(asset.r2Key);
  await fetch(uploadUrl, { method: "PUT", headers, body });
  await request(app.getHttpServer()).post(`/v1/assets/${asset.id}/complete`);
  return asset.id as string;
}

// Uploads real bytes but does NOT call the generic /complete - the font
// auto-parse tests below call /v1/fonts/upload/complete themselves instead.
async function uploadFontBytes(contents: Buffer, originalFilename: string, mimeType = "font/ttf") {
  const requestResponse = await request(app.getHttpServer())
    .post("/v1/assets/upload-requests")
    .send({ workspaceId: seedWorkspaceId, mimeType, byteSize: contents.byteLength, kind: "font", originalFilename });
  const { asset, uploadUrl, headers } = requestResponse.body;
  createdAssetIds.push(asset.id);
  uploadedR2Keys.push(asset.r2Key);
  await fetch(uploadUrl, { method: "PUT", headers, body: contents });
  return asset.id as string;
}

const REAL_FONT_PATH = path.resolve(__dirname, "../../../../apps/web/public/preview/font/Albert_Sans/AlbertSans-100.ttf");

describe("fonts routes (Nest, real Neon dev DB + real R2 asset)", () => {
  it("creates a font family, attaches a real font asset as a face, and lists it", async () => {
    const slug = `test-font-${randomUUID().slice(0, 8)}`;
    const familyResponse = await request(app.getHttpServer())
      .post("/v1/fonts/families")
      .send({ workspaceId: seedWorkspaceId, slug, familyName: "Test Font" });
    expect(familyResponse.status).toBe(201);
    const familyId = familyResponse.body.fontFamily.id;
    createdFamilyIds.push(familyId);

    const fontAssetId = await uploadRealAsset("font", "font/woff2", "not-a-real-font-binary-just-bytes");

    const faceResponse = await request(app.getHttpServer())
      .post(`/v1/fonts/families/${familyId}/faces`)
      .send({ assetId: fontAssetId, faceKey: "regular", weight: 400, format: "woff2" });
    expect(faceResponse.status).toBe(201);
    expect(faceResponse.body.fontFace.fontFamilyId).toBe(familyId);

    const listResponse = await request(app.getHttpServer()).get(`/v1/fonts/families/${familyId}/faces`);
    expect(listResponse.body.fontFaces).toHaveLength(1);
  });

  it("rejects creating a font family with a slug already used in the workspace", async () => {
    const slug = `test-font-dup-${randomUUID().slice(0, 8)}`;
    const first = await request(app.getHttpServer())
      .post("/v1/fonts/families")
      .send({ workspaceId: seedWorkspaceId, slug, familyName: "First" });
    expect(first.status).toBe(201);
    createdFamilyIds.push(first.body.fontFamily.id);

    const duplicate = await request(app.getHttpServer())
      .post("/v1/fonts/families")
      .send({ workspaceId: seedWorkspaceId, slug, familyName: "Second" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("font_family_conflict");
  });

  it("rejects attaching a non-font asset as a face (validate_user_font_asset)", async () => {
    const familyResponse = await request(app.getHttpServer())
      .post("/v1/fonts/families")
      .send({ workspaceId: seedWorkspaceId, slug: `test-font-reject-${randomUUID().slice(0, 8)}`, familyName: "Reject Test" });
    const familyId = familyResponse.body.fontFamily.id;
    createdFamilyIds.push(familyId);

    const imageAssetId = await uploadRealAsset("image", "image/png", "not-a-real-png");

    const faceResponse = await request(app.getHttpServer())
      .post(`/v1/fonts/families/${familyId}/faces`)
      .send({ assetId: imageAssetId, faceKey: "regular", weight: 400, format: "woff2" });
    expect(faceResponse.status).toBe(422);
    expect(faceResponse.body.error.code).toBe("invalid_font_asset");
  });

  it("links a font family to a project only when they share a workspace (validate_project_user_font_family)", async () => {
    const familyResponse = await request(app.getHttpServer())
      .post("/v1/fonts/families")
      .send({ workspaceId: seedWorkspaceId, slug: `test-font-link-${randomUUID().slice(0, 8)}`, familyName: "Link Test" });
    const familyId = familyResponse.body.fontFamily.id;
    createdFamilyIds.push(familyId);

    const projectResponse = await request(app.getHttpServer())
      .post("/v1/projects")
      .send({ workspaceId: seedWorkspaceId, title: "Font link test project" });
    const projectId = projectResponse.body.project.id;
    createdProjectIds.push(projectId);

    const linkResponse = await request(app.getHttpServer())
      .post("/v1/fonts/project-links")
      .send({ projectId, fontFamilyId: familyId, alias: "My Alias" });
    expect(linkResponse.status).toBe(201);

    const listResponse = await request(app.getHttpServer()).get(`/v1/fonts/project-links?projectId=${projectId}`);
    expect(listResponse.body.projectFontFamilies).toHaveLength(1);
    expect(listResponse.body.projectFontFamilies[0].alias).toBe("My Alias");

    const deleteResponse = await request(app.getHttpServer())
      .delete("/v1/fonts/project-links")
      .send({ projectId, fontFamilyId: familyId });
    expect(deleteResponse.status).toBe(204);
  });

  describe("font upload auto-parse (real fontkit binary parsing)", () => {
    // Every test here uploads the SAME real font file's bytes (content-hash
    // dedup is exactly what's being tested), so each test must clean up its
    // own auto-created family immediately - not rely on the file's shared
    // afterAll - or a later test's "fresh" upload collides with an earlier
    // test's still-`ready` asset of identical content.
    // Deletes the auto-created family AND the given (still-`ready`) asset
    // row(s) - leaving the asset behind would make the NEXT test's "fresh"
    // upload of the same file bytes collide with this test's content-hash,
    // since the dedup check only cares about `assets.content_hash`, not
    // which font family/face it ended up under.
    async function cleanupAutoCreatedFont(assetIds: string[]) {
      const family = await db.query.userFontFamilies.findFirst({
        where: and(eq(userFontFamilies.workspaceId, seedWorkspaceId), eq(userFontFamilies.familyName, "Albert Sans")),
      });
      if (family) await db.delete(userFontFamilies).where(eq(userFontFamilies.id, family.id));
      if (assetIds.length > 0) await db.delete(assets).where(inArray(assets.id, assetIds));
    }

    it("auto-parses a real font upload, creating the family and face automatically", async () => {
      const contents = readFileSync(REAL_FONT_PATH);
      const assetId = await uploadFontBytes(contents, "AlbertSans-100.ttf");
      try {
        const response = await request(app.getHttpServer()).post("/v1/fonts/upload/complete").send({ assetId });
        expect(response.status).toBe(201);
        expect(response.body.font.familyName).toBe("Albert Sans");
        expect(response.body.font.weight).toBe(100);
        expect(response.body.font.style).toBe("normal");
        expect(response.body.font.format).toBe("ttf");
        expect(response.body.font.source).toBe("custom");
        expect(response.body.font.uri).toBe(`/v1/assets/${assetId}/media`);
        expect(response.body.font.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);

        const asset = await request(app.getHttpServer()).get(`/v1/assets/${assetId}`);
        expect(asset.body.asset.status).toBe("ready");
      } finally {
        await cleanupAutoCreatedFont([assetId]);
      }
    });

    it("rejects and discards a duplicate upload of the exact same font content", async () => {
      const contents = readFileSync(REAL_FONT_PATH);
      const first = await uploadFontBytes(contents, "AlbertSans-100-first.ttf");
      try {
        const firstComplete = await request(app.getHttpServer()).post("/v1/fonts/upload/complete").send({ assetId: first });
        expect(firstComplete.status).toBe(201);

        const second = await uploadFontBytes(contents, "AlbertSans-100-second.ttf");
        const secondComplete = await request(app.getHttpServer()).post("/v1/fonts/upload/complete").send({ assetId: second });
        expect(secondComplete.status).toBe(409);
        expect(secondComplete.body.error.code).toBe("font_upload_conflict");

        // Discarded, not left dangling in "uploading" status.
        const discardedAsset = await db.query.assets.findFirst({ where: eq(assets.id, second) });
        expect(discardedAsset).toBeUndefined();
      } finally {
        await cleanupAutoCreatedFont([first]);
      }
    });

    it("rejects and discards an upload that isn't a real font binary", async () => {
      const assetId = await uploadFontBytes(Buffer.from("not a real font file"), "fake.ttf");
      const response = await request(app.getHttpServer()).post("/v1/fonts/upload/complete").send({ assetId });
      expect(response.status).toBe(400);

      const discardedAsset = await db.query.assets.findFirst({ where: eq(assets.id, assetId) });
      expect(discardedAsset).toBeUndefined();
    });
  });
});
