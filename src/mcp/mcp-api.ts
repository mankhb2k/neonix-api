import type { RemoteMcpProjectApi } from "@motionvideo/motion-mcp/remote";
import { HttpException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { AssetsService } from "../assets/assets.service";
import { ApiError } from "../common/api-error";
import type { Database } from "../db/client";
import { projects } from "../db/schema/projects";
import { ProjectsService } from "../projects/projects.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

export interface McpApiDeps {
  db: Database;
  workspaces: WorkspacesService;
  projects: ProjectsService;
  assets: AssetsService;
  webAppUrl: string;
}

// ApiError is a NestJS HttpException whose real message/code live inside its
// response body; motion-mcp's toolError() only reads `.message` / `.code`, so
// without this translation every failure would surface as a generic
// "Http Exception" / TOOL_ERROR.
const STATUS_CODES: Record<number, string> = {
  400: "INVALID_INPUT",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "INVALID_INPUT",
};

function translateError(error: unknown): unknown {
  if (!(error instanceof HttpException)) return error;
  const body = error.getResponse() as { error?: { message?: string; code?: string; details?: unknown } } | string;
  const info = typeof body === "string" ? undefined : body.error;
  const translated = new Error(info?.message ?? error.message) as Error & { code: string; details?: unknown };
  translated.code = info?.code ?? STATUS_CODES[error.getStatus()] ?? "TOOL_ERROR";
  if (info?.details !== undefined) translated.details = info.details;
  return translated;
}

function withToolErrors(api: RemoteMcpProjectApi): RemoteMcpProjectApi {
  const wrapped = Object.fromEntries(
    Object.entries(api).map(([name, method]) => [
      name,
      async (...args: unknown[]) => {
        try {
          return await (method as (...input: unknown[]) => Promise<unknown>)(...args);
        } catch (error) {
          throw translateError(error);
        }
      },
    ]),
  );
  return wrapped as unknown as RemoteMcpProjectApi;
}

function notImplemented(tool: string): never {
  const error = new Error(`${tool} is not ported to apps/api yet`) as Error & { code: string };
  error.code = "NOT_IMPLEMENTED";
  throw error;
}

// Resolves the id/publicRef ambiguity every project-scoped tool input allows
// (an MCP caller may know either). Existing NestJS services only accept the
// internal uuid, so this is the one lookup shared across every method below
// rather than duplicated per-tool.
async function resolveProjectId(db: Database, input: { projectId?: string; publicRef?: string }): Promise<string> {
  if (input.projectId) return input.projectId;
  if (input.publicRef) {
    const row = await db.query.projects.findFirst({ where: eq(projects.publicRef, input.publicRef) });
    if (!row) throw new ApiError(404, "Project not found");
    return row.id;
  }
  throw new ApiError(400, "projectId or publicRef is required");
}

async function resolveHtmlProject(
  db: Database,
  projectsService: ProjectsService,
  userId: string,
  input: { projectId?: string; publicRef?: string },
) {
  const projectId = await resolveProjectId(db, input);
  const project = await projectsService.getForMember(userId, projectId);
  return project;
}

/**
 * First slice of the RemoteMcpProjectApi port (see project memory: MCP
 * porting is staged, same as the REST API was). Implements every tool that
 * maps directly onto an existing apps/api NestJS service with no new
 * business logic. Tools needing net-new logic (HTML track, JSON patch
 * engine, asset-project linking, asset import-by-url, export download URLs,
 * document API) throw a clear NOT_IMPLEMENTED tool error instead of
 * crashing or silently no-op'ing - motion-mcp's `toolError()` turns that
 * into a proper MCP tool error response, not a transport-level failure.
 */
export function buildMcpProjectApi(deps: McpApiDeps, userId: string): RemoteMcpProjectApi {
  const { db, workspaces, projects: projectsService, assets: assetsService, webAppUrl } = deps;

  async function resolveWorkspaceId(workspaceId?: string): Promise<string> {
    if (workspaceId) return workspaceId;
    const [first] = await workspaces.listForUser(userId);
    if (!first) throw new ApiError(404, "No accessible workspace");
    return first.id;
  }

  const api: RemoteMcpProjectApi = {
    async listWorkspaces() {
      const rows = await workspaces.listForUser(userId);
      return rows.map((w) => ({ id: w.id, name: w.name, role: w.role, created_at: w.createdAt.toISOString() }));
    },

    async listProjects(input) {
      const workspaceId = await resolveWorkspaceId(input.workspaceId);
      const workspace = await workspaces.getForMember(userId, workspaceId);
      const rows = (await projectsService.list(userId, workspaceId));
      const limited = input.limit ? rows.slice(0, input.limit) : rows;
      return {
        workspace: { id: workspace.id, name: workspace.name, created_at: workspace.createdAt.toISOString() },
        projects: limited.map(projectToJson),
      };
    },

    async getProject(input) {
      return projectToJson(await resolveHtmlProject(db, projectsService, userId, input));
    },

    async updateProject(input) {
      const current = await resolveHtmlProject(db, projectsService, userId, input);
      const project = input.title !== undefined ? await projectsService.update(userId, current.id, input.title) : current;
      return { project: projectToJson(project) };
    },

    async deleteProject(input) {
      const project = await resolveHtmlProject(db, projectsService, userId, input);
      await projectsService.softDelete(userId, project.id);
      return { projectId: project.id, deleted: true };
    },

    async listAssets(input) {
      if (!input.workspaceId) throw new ApiError(400, "workspaceId is required");
      const rows = await assetsService.list(userId, input.workspaceId);
      return { workspaceId: input.workspaceId, assets: rows.map(assetToJson) };
    },

    async requestAssetUpload(input) {
      if (!input.workspaceId) throw new ApiError(400, "workspaceId is required");
      const kind = input.mimeType.startsWith("image/") ? "image" : input.mimeType.startsWith("font/") ? "font" : "asset";
      const { asset, uploadUrl, headers, expiresAt } = await assetsService.createUploadRequest(userId, {
        workspaceId: input.workspaceId,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        kind,
        originalFilename: input.filename,
      });
      return { asset: assetToJson(asset), uploadUrl, method: "PUT", headers, expiresAt: expiresAt.toISOString() };
    },

    async completeAssetUpload(input) {
      const asset = await assetsService.completeUpload(userId, input.assetId);
      return { asset: assetToJson(asset), alreadyCompleted: false };
    },

    async deleteAsset(input) {
      const asset = await assetsService.softDelete(userId, input.assetId);
      return { assetId: asset.id, deleted: true, deletion: assetToJson(asset) };
    },

    async createExport(input) {
      await resolveHtmlProject(db, projectsService, userId, input);
      // The HTML frame-render export pipeline is not built yet.
      notImplemented("create_export");
    },

    async getExport() {
      notImplemented("get_export");
    },

    async getExportDownloadUrl() {
      notImplemented("get_export_download_url");
    },

    async cancelExport() {
      notImplemented("cancel_export");
    },

    async openPreview(input) {
      const project = await resolveHtmlProject(db, projectsService, userId, input);
      return { project_id: project.id, public_ref: project.publicRef, preview_url: `${webAppUrl}/preview/${project.id}` };
    },

    async createProjectHtml(input) {
      const workspaceId = await resolveWorkspaceId(input.workspaceId);
      const workspace = await workspaces.getForMember(userId, workspaceId);
      const result = await projectsService.createHtmlProject(userId, {
        workspaceId,
        title: input.title,
        html: input.html ?? "",
        idempotencyKey: input.idempotencyKey,
      });
      return {
        project: projectToJson(result.project),
        workspace: { id: workspace.id, name: workspace.name, created_at: workspace.createdAt.toISOString() },
        alreadyCreated: result.alreadyCreated,
      };
    },

    async getProjectHtml(input) {
      const project = await resolveHtmlProject(db, projectsService, userId, input);
      const result = await projectsService.getHtmlDocument(userId, project.id);
      return { project: projectToJson(result.project), html: result.html };
    },

    async updateProjectHtml(input) {
      const project = await resolveHtmlProject(db, projectsService, userId, input);
      const result = await projectsService.updateHtmlDocument(userId, project.id, input.html);
      return { project: projectToJson(result.project) };
    },

    async attachAssetToProject(input) {
      const project = await resolveHtmlProject(db, projectsService, userId, input);
      await projectsService.attachAsset(userId, project.id, input.assetId);
      return { projectId: project.id, assetId: input.assetId, attached: true };
    },

    async importAsset() {
      notImplemented("import_asset");
    },
  };

  return withToolErrors(api);
}

function projectToJson(project: { id: string; publicRef: string; workspaceId: string; title: string }) {
  return {
    id: project.id,
    public_ref: project.publicRef,
    workspace_id: project.workspaceId,
    title: project.title,
  };
}

function assetToJson(asset: { id: string; originalFilename: string | null; mimeType: string; kind: string; byteSize: number; status: string; createdAt: Date }) {
  return {
    assetId: asset.id,
    filename: asset.originalFilename,
    mimeType: asset.mimeType,
    kind: asset.kind,
    byteSize: asset.byteSize,
    status: asset.status,
    createdAt: asset.createdAt.toISOString(),
  };
}
