// Creates (or refreshes) the "Neonix 60s showcase" project on the demo account: the HTML from
// packages/render-html/examples/demo-1min/project.html, with the demo account's uploaded video and music attached
// at the paths the HTML refers to (project_assets.path).
//
// Inserts straight into the database because ProjectsService still rejects <script> tags in project HTML.
//
// Usage (from apps/api): npx tsx --env-file=.env scripts/seed-demo-1min-project.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { assets, projectAssets } from "../src/db/schema/assets";
import { user } from "../src/db/schema/auth";
import { workspaces } from "../src/db/schema/identity";
import { projectHtmlDocuments, projects } from "../src/db/schema/projects";

const DEMO_EMAIL = process.env.DEMO_EMAIL?.trim() || "demo@gmail.com";
const TITLE = "Neonix 60s showcase";
const HTML_PATH = resolve(__dirname, "../../../packages/render-html/examples/demo-1min/project.html");

// file name of the uploaded asset -> path inside the render bundle
const ATTACH: Array<{ filename: string; kind: string; path: string }> = [
  { filename: "0829.mp4", kind: "video", path: "assets/video/0829.mp4" },
  { filename: "Music-MBB-Island-Tropical_128k.mp3", kind: "audio", path: "assets/audio/music.mp3" },
];

async function main() {
  const owner = await db.query.user.findFirst({ where: eq(user.email, DEMO_EMAIL) });
  if (!owner) throw new Error(`user ${DEMO_EMAIL} not found`);
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.createdBy, owner.id) });
  if (!workspace) throw new Error("demo workspace not found");

  const html = readFileSync(HTML_PATH, "utf8");
  const contentHash = createHash("sha256").update(html, "utf8").digest("hex");
  const byteSize = Buffer.byteLength(html, "utf8");

  let project = await db.query.projects.findFirst({
    where: and(eq(projects.workspaceId, workspace.id), eq(projects.title, TITLE), isNull(projects.deletedAt)),
  });
  if (project) {
    await db
      .update(projectHtmlDocuments)
      .set({ html, contentHash, byteSize, updatedAt: new Date() })
      .where(eq(projectHtmlDocuments.projectId, project.id));
    console.log(`[seed] refreshed HTML of project ${project.id}`);
  } else {
    [project] = await db
      .insert(projects)
      .values({ workspaceId: workspace.id, title: TITLE, createdBy: owner.id })
      .returning();
    await db.insert(projectHtmlDocuments).values({ projectId: project!.id, html, contentHash, byteSize, createdBy: owner.id });
    console.log(`[seed] created project ${project!.id}`);
  }

  for (const item of ATTACH) {
    const [asset] = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.workspaceId, workspace.id),
          eq(assets.originalFilename, item.filename),
          eq(assets.kind, item.kind),
          eq(assets.status, "ready"),
          isNull(assets.deletedAt),
        ),
      )
      .orderBy(desc(assets.createdAt))
      .limit(1);
    if (!asset) throw new Error(`ready ${item.kind} asset "${item.filename}" not found in the demo workspace - upload it first`);
    await db
      .insert(projectAssets)
      .values({ projectId: project!.id, assetId: asset.id, attachedBy: owner.id, path: item.path })
      .onConflictDoUpdate({ target: [projectAssets.projectId, projectAssets.assetId], set: { path: item.path } });
    console.log(`[seed] attached ${item.filename} (${asset.id}) as ${item.path}`);
  }

  console.log(`[seed] PROJECT_ID=${project!.id} PUBLIC_REF=${project!.publicRef}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
