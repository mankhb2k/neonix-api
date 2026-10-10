import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { AuthzService } from "../authz/authz.service";
import { ApiError } from "../common/api-error";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { projects } from "../db/schema/projects";
import { htmlRenderJobs } from "../db/schema/render";
import { QuotasService } from "../quotas/quotas.service";
import { R2Service } from "../r2/r2.service";

const TREND_DAYS = 14;
const RECENT_LIMIT = 5;
const DOWNLOAD_TTL_SECONDS = 300;

@Injectable()
export class ExportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authz: AuthzService,
    private readonly quotas: QuotasService,
    private readonly r2: R2Service,
  ) {}

  private async requireViewer(userId: string, workspaceId: string) {
    const canView = await this.authz.hasWorkspaceRole(userId, workspaceId, "viewer");
    if (!canView) throw new ApiError(404, "Workspace not found");
  }

  async list(userId: string, workspaceId: string) {
    await this.requireViewer(userId, workspaceId);
    const rows = await this.db
      .select({
        job: htmlRenderJobs,
        projectTitle: projects.title,
      })
      .from(htmlRenderJobs)
      .leftJoin(projects, eq(projects.id, htmlRenderJobs.projectId))
      .where(eq(htmlRenderJobs.workspaceId, workspaceId))
      .orderBy(desc(htmlRenderJobs.createdAt))
      .limit(200);

    return rows.map(({ job, projectTitle }) => ({
      id: job.id,
      projectId: job.projectId,
      projectTitle,
      status: job.status,
      progress: job.status === "done" ? 1 : 0,
      error: job.errorMessage,
      outputKey: job.outputKey,
      durationMs: job.durationMs,
      fps: job.fps,
      costVnd: job.costVnd,
      outputBytes: job.outputBytes,
      createdAt: job.createdAt.toISOString(),
    }));
  }

  async summary(userId: string, workspaceId: string) {
    await this.requireViewer(userId, workspaceId);

    const done = and(eq(htmlRenderJobs.workspaceId, workspaceId), eq(htmlRenderJobs.status, "done"));

    const [totals] = await this.db
      .select({
        count: sql<string>`count(*)`,
        durationMs: sql<string>`coalesce(sum(${htmlRenderJobs.durationMs}), 0)`,
        costVnd: sql<string>`coalesce(sum(${htmlRenderJobs.costVnd}), 0)`,
      })
      .from(htmlRenderJobs)
      .where(done);

    const dailyRows = await this.db
      .select({
        day: sql<string>`to_char(${htmlRenderJobs.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        count: sql<string>`count(*)`,
      })
      .from(htmlRenderJobs)
      .where(and(done, sql`${htmlRenderJobs.createdAt} >= now() - interval '${sql.raw(String(TREND_DAYS))} days'`))
      .groupBy(sql`1`);
    const countByDay = new Map(dailyRows.map((row) => [row.day, Number(row.count)]));
    const daily = Array.from({ length: TREND_DAYS }, (_, index) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - (TREND_DAYS - 1 - index));
      const day = date.toISOString().slice(0, 10);
      return { date: day, count: countByDay.get(day) ?? 0 };
    });

    const recentRows = await this.db
      .select({ id: htmlRenderJobs.id, title: projects.title, durationMs: htmlRenderJobs.durationMs })
      .from(htmlRenderJobs)
      .leftJoin(projects, eq(projects.id, htmlRenderJobs.projectId))
      .where(done)
      .orderBy(desc(htmlRenderJobs.createdAt))
      .limit(RECENT_LIMIT);

    const workspace = await this.quotas.getWorkspaceOrThrow(workspaceId);
    const projectLimit = await this.quotas.getActiveProjectLimit(workspace);
    const projectCount = await this.db.$count(
      projects,
      and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)),
    );

    return {
      exportedCount: Number(totals?.count ?? 0),
      totalDurationMs: Number(totals?.durationMs ?? 0),
      totalCostVnd: Number(totals?.costVnd ?? 0),
      daily,
      recent: recentRows.map((row) => ({ id: row.id, title: row.title ?? "", durationMs: row.durationMs ?? 0 })),
      projectCount,
      projectLimit,
    };
  }

  async getDownloadUrl(userId: string, jobId: string) {
    const job = await this.db.query.htmlRenderJobs.findFirst({ where: eq(htmlRenderJobs.id, jobId) });
    if (!job) throw new ApiError(404, "Export not found");
    await this.requireViewer(userId, job.workspaceId);
    if (job.status !== "done" || !job.outputKey) throw new ApiError(409, "Export is not ready", "export_not_ready");
    return this.r2.presignGet("R2_USER_EXPORTS_BUCKET", job.outputKey, DOWNLOAD_TTL_SECONDS);
  }
}
