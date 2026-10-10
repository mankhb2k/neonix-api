import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { assets } from "../db/schema/assets";
import { accountPlans, teamPlans, workspaces } from "../db/schema/identity";

type WorkspaceLike = { id: string; kind: string; createdBy: string };

@Injectable()
export class QuotasService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Replaces `enforce_project_count_limit()` (Postgres trigger, raised
  // SQLSTATE P0003). Resolves the limit from team_plans (pooled) for a team
  // workspace, or account_plans (personal, keyed by the workspace owner)
  // otherwise - same resolution rule as the original trigger.
  async getActiveProjectLimit(workspace: WorkspaceLike): Promise<number> {
    if (workspace.kind === "team") {
      const plan = await this.db.query.teamPlans.findFirst({ where: eq(teamPlans.workspaceId, workspace.id) });
      return plan?.maxActiveProjects ?? 0;
    }
    const plan = await this.db.query.accountPlans.findFirst({ where: eq(accountPlans.id, workspace.createdBy) });
    return plan?.maxActiveProjects ?? 0;
  }

  // Replaces `enforce_asset_account_quota()`'s limit-resolution half.
  async getStorageLimits(workspace: WorkspaceLike): Promise<{ storageQuotaBytes: number; maxUploadBytes: number }> {
    if (workspace.kind === "team") {
      const plan = await this.db.query.teamPlans.findFirst({ where: eq(teamPlans.workspaceId, workspace.id) });
      return { storageQuotaBytes: plan?.storageQuotaBytes ?? 0, maxUploadBytes: plan?.maxUploadBytes ?? 0 };
    }
    const plan = await this.db.query.accountPlans.findFirst({ where: eq(accountPlans.id, workspace.createdBy) });
    return { storageQuotaBytes: plan?.storageQuotaBytes ?? 0, maxUploadBytes: plan?.maxUploadBytes ?? 0 };
  }

  // Replaces `workspace_storage_used_bytes()`.
  async getWorkspaceStorageUsedBytes(workspaceId: string): Promise<number> {
    const rows = await this.db.query.assets.findMany({
      where: and(eq(assets.workspaceId, workspaceId), isNull(assets.deletedAt), ne(assets.status, "deleted")),
      columns: { byteSize: true },
    });
    return rows.reduce((sum, row) => sum + row.byteSize, 0);
  }

  async getWorkspaceOrThrow(workspaceId: string) {
    const workspace = await this.db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (!workspace) throw new Error("workspace_not_found");
    return workspace;
  }
}
