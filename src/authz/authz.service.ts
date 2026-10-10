import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../db/database.module";
import type { Database } from "../db/client";
import { workspaceMembers } from "../db/schema/identity";

export type WorkspaceRole = "owner" | "editor" | "viewer";

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, owner: 2 };

// Replaces the former database `has_workspace_role(workspace_id, minimum_role)` helper
// function - there it existed purely to be called from RLS policies; here
// it's the same owner ⊇ editor ⊇ viewer hierarchy check as plain app code,
// called explicitly from each route instead of implicitly by Postgres.
@Injectable()
export class AuthzService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getWorkspaceRole(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
    const membership = await this.db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
    });
    return (membership?.role as WorkspaceRole | undefined) ?? null;
  }

  async hasWorkspaceRole(userId: string, workspaceId: string, minimumRole: WorkspaceRole): Promise<boolean> {
    const role = await this.getWorkspaceRole(userId, workspaceId);
    if (!role) return false;
    return ROLE_RANK[role] >= ROLE_RANK[minimumRole];
  }
}
