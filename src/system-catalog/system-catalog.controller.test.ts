import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { DatabaseModule } from "../db/database.module";
import { seedUserGuard } from "../test/seed-user-guard";
import { SystemCatalogModule } from "./system-catalog.module";

const seedUserId = process.env.SEED_USER_ID!;

// Stable system-catalog rows with fixed ids/sizes, safe to assert on.
const SMALL_FONT_FILE_ID = "31e31ff2-0d6e-4ea8-ba8e-6b518f780408"; // Urbanist-100.ttf
const SMALL_FONT_FILE_SIZE = 43188;
const SVG_PLACEHOLDER_ID = "system:svg-placeholder";
const SVG_PLACEHOLDER_SIZE = 906;
const VIDEO_PLACEHOLDER_ID = "system:video-placeholder";
const VIDEO_PLACEHOLDER_POSTER_SIZE = 133950;

let app: INestApplication;
let authedApp: INestApplication;

beforeAll(async () => {
  const publicModuleRef = await Test.createTestingModule({
    imports: [DatabaseModule, SystemCatalogModule],
  }).compile();
  app = publicModuleRef.createNestApplication();
  await app.init();

  const authedModuleRef = await Test.createTestingModule({
    imports: [DatabaseModule, SystemCatalogModule],
  })
    .overrideGuard(CurrentUserGuard)
    .useValue(seedUserGuard(seedUserId))
    .compile();
  authedApp = authedModuleRef.createNestApplication();
  await authedApp.init();
});

afterAll(async () => {
  await app.close();
  await authedApp.close();
});

describe("system catalog routes (Nest, real Neon dev DB + real R2 system buckets)", () => {
  it("serves the public font catalog with CDN uris and no auth required", async () => {
    const response = await request(app.getHttpServer()).get("/v1/system-fonts");
    expect(response.status).toBe(200);
    expect(response.body.scope).toBe("public");
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    const urbanist = response.body.fonts.find((f: { id: string }) => f.id === `system:${SMALL_FONT_FILE_ID}`);
    expect(urbanist).toBeDefined();
    expect(urbanist.uri).toBe("https://fonts.neonix.video/Urbanist/Urbanist-100.ttf");
    expect(urbanist.familyName).toBe("Urbanist");
    expect(urbanist.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("responds to the public catalog OPTIONS preflight", async () => {
    const response = await request(app.getHttpServer()).options("/v1/system-fonts");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("rejects the authenticated font-file byte proxy without a session", async () => {
    const response = await request(app.getHttpServer()).get(`/v1/system-fonts/${SMALL_FONT_FILE_ID}`);
    expect(response.status).toBe(401);
  });

  it("streams a real system font file's bytes when authenticated", async () => {
    const response = await request(authedApp.getHttpServer()).get(`/v1/system-fonts/${SMALL_FONT_FILE_ID}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("font/ttf");
    expect(response.headers["content-length"]).toBe(String(SMALL_FONT_FILE_SIZE));
    expect(response.body.length).toBe(SMALL_FONT_FILE_SIZE);
  });

  it("404s a font-file id that doesn't exist", async () => {
    const response = await request(authedApp.getHttpServer()).get("/v1/system-fonts/00000000-0000-0000-0000-000000000000");
    expect(response.status).toBe(404);
  });

  it("streams a real system asset placeholder's bytes when authenticated", async () => {
    const response = await request(authedApp.getHttpServer()).get(`/v1/system-assets/${SVG_PLACEHOLDER_ID}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/svg+xml");
    expect(response.headers["content-length"]).toBe(String(SVG_PLACEHOLDER_SIZE));
  });

  it("resolves a variant via parent_id (video placeholder's poster)", async () => {
    const response = await request(authedApp.getHttpServer()).get(`/v1/system-assets/${VIDEO_PLACEHOLDER_ID}?variant=poster`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");
    expect(response.headers["content-length"]).toBe(String(VIDEO_PLACEHOLDER_POSTER_SIZE));
  });

  it("serves a partial range with 206 and Content-Range", async () => {
    const response = await request(authedApp.getHttpServer())
      .get(`/v1/system-assets/${SVG_PLACEHOLDER_ID}`)
      .set("Range", "bytes=0-99");
    expect(response.status).toBe(206);
    expect(response.headers["content-range"]).toBe(`bytes 0-99/${SVG_PLACEHOLDER_SIZE}`);
    expect(response.headers["content-length"]).toBe("100");
    expect(response.body.length).toBe(100);
  });

  it("rejects an out-of-bounds range with 416", async () => {
    const response = await request(authedApp.getHttpServer())
      .get(`/v1/system-assets/${SVG_PLACEHOLDER_ID}`)
      .set("Range", `bytes=${SVG_PLACEHOLDER_SIZE + 100}-${SVG_PLACEHOLDER_SIZE + 200}`);
    expect(response.status).toBe(416);
    expect(response.headers["content-range"]).toBe(`bytes */${SVG_PLACEHOLDER_SIZE}`);
  });

  it("404s a system asset id that doesn't exist", async () => {
    const response = await request(authedApp.getHttpServer()).get("/v1/system-assets/system:does-not-exist");
    expect(response.status).toBe(404);
  });
});
