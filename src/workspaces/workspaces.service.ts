import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { AuthzService } from "../authz/authz.service";
import { ApiError } from "../common/api-error";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { workspaceMembers, workspaces } from "../db/schema/identity";

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authz: AuthzService,
  ) {}

  async listForUser(userId: string) {
    const rows = await this.db
      .select({ workspace: workspaces, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId));
    return rows.map(({ workspace, role }) => ({ ...workspace, role }));
  }

  async getForMember(userId: string, workspaceId: string) {
    const canView = await this.authz.hasWorkspaceRole(userId, workspaceId, "viewer");
    if (!canView) throw new ApiError(404, "Workspace not found");
    const workspace = await this.db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (!workspace) throw new ApiError(404, "Workspace not found");
    return workspace;
  }

  // Original hosted-database grants only ever let authenticated users update the
  // `name` column (`grant update (name) to authenticated`), independent of
  // the RLS policy's broader USING/WITH CHECK clause - replicated here by
  // only ever accepting `name` as input in the DTO, never the rest of the row.
  async rename(userId: string, workspaceId: string, name: string) {
    const canEdit = await this.authz.hasWorkspaceRole(userId, workspaceId, "editor");
    if (!canEdit) throw new ApiError(404, "Workspace not found");
    const [updated] = await this.db
      .update(workspaces)
      .set({ name, updatedAt: sql`now()` })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return updated;
  }
}
