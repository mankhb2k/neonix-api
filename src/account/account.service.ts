import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { workspaces } from "../db/schema/identity";
import { QuotasService } from "../quotas/quotas.service";

@Injectable()
export class AccountService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly quotas: QuotasService,
  ) {}

  // Every user gets exactly one `kind: 'personal'` workspace at signup
  // (provisionNewUser, see auth/provision.ts) - storage usage/quota is
  // reported for that workspace, matching the previous route's
  // `account_plans`/`account_storage_used_bytes(account_id)` semantics
  // (a personal account and its personal workspace are 1:1).
  async getStorageUsage(userId: string) {
    const workspace = await this.db.query.workspaces.findFirst({
      where: and(eq(workspaces.createdBy, userId), eq(workspaces.kind, "personal")),
    });
    if (!workspace) throw new ApiError(404, "No personal workspace found for account");

    const [{ storageQuotaBytes }, usedBytes] = await Promise.all([
      this.quotas.getStorageLimits(workspace),
      this.quotas.getWorkspaceStorageUsedBytes(workspace.id),
    ]);

    return {
      usedBytes,
      quotaBytes: storageQuotaBytes,
      availableBytes: Math.max(0, storageQuotaBytes - usedBytes),
      usedPercent: storageQuotaBytes > 0 ? Math.min(100, (usedBytes / storageQuotaBytes) * 100) : 0,
    };
  }
}
