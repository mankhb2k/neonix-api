// Builds a render-job manifest for a project and uploads it to R2, so a Cloud Run job (or a local run of
// packages/render-html/job_entry.py) can render it without any storage credentials: every asset is a signed GET URL
// and the output is a signed PUT URL.
//
// Usage (from apps/api): npx tsx --env-file=.env scripts/prepare-render-test.ts <projectId> [workers] [htmlFile] [durationSeconds]
// `htmlFile` renders that HTML instead of the project's own (the project still supplies the assets).
// Prints one JSON line: { runId, manifestUrl, outputKey }.   `--check <outputKey>` prints the output object's size.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { assets, projectAssets } from "../src/db/schema/assets";
import { projectHtmlDocuments } from "../src/db/schema/projects";
import { R2Service } from "../src/r2/r2.service";

const USER_ASSETS = "R2_USER_ASSETS_BUCKET";
const EXPORTS = "R2_USER_EXPORTS_BUCKET";
const r2 = new R2Service();

async function main() {
  if (process.argv[2] === "--check") {
    const head = await r2.headObject(EXPORTS, process.argv[3]!);
    console.log(JSON.stringify(head));
    await pool.end();
    return;
  }
  const projectId = process.argv[2];
  if (!projectId) throw new Error("usage: prepare-render-test.ts <projectId> [workers]");
  const workers = Number(process.argv[3] ?? 0);
  const htmlOverride = process.argv[4] ? readFileSync(process.argv[4], "utf8") : null;
  const durationSeconds = process.argv[5] ? Number(process.argv[5]) : null;

  const document = await db.query.projectHtmlDocuments.findFirst({ where: eq(projectHtmlDocuments.projectId, projectId) });
  if (!document) throw new Error("project HTML not found");
  const rows = await db
    .select({ path: projectAssets.path, key: assets.r2Key })
    .from(projectAssets)
    .innerJoin(assets, eq(assets.id, projectAssets.assetId))
    .where(eq(projectAssets.projectId, projectId));

  const ttl = 3 * 3600;
  const runId = randomUUID().slice(0, 8);
  const outputKey = `render-tests/${runId}/output.mp4`;
  const manifest = {
    html: htmlOverride ?? document.html,
    assets: await Promise.all(
      // only the assets the HTML actually refers to (a CSS-only page downloads nothing)
      rows.filter((row) => row.path && (htmlOverride ?? document.html).includes(row.path)).map(async (row) => ({ path: row.path, url: (await r2.presignGet(USER_ASSETS, row.key, ttl)).url })),
    ),
    output: { url: (await r2.presignPut(EXPORTS, outputKey, "video/mp4", ttl)).url, contentType: "video/mp4" },
    options: { workers, ...(durationSeconds ? { duration: durationSeconds } : {}) },
  };
  const manifestKey = `render-tests/${runId}/manifest.json`;
  await r2.putObject(EXPORTS, { key: manifestKey, body: Buffer.from(JSON.stringify(manifest)), contentType: "application/json" });
  const manifestUrl = (await r2.presignGet(EXPORTS, manifestKey, ttl)).url;
  console.log(JSON.stringify({ runId, manifestUrl, outputKey, assets: manifest.assets.length }));
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
