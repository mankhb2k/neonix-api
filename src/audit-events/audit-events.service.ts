import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { AuthzService } from "../authz/authz.service";
import { ApiError } from "../common/api-error";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { auditEvents } from "../db/schema/misc";

// Original RLS restricted insert to `actor_user_id = auth.uid()` (self-log
// only) - `actorUserId` is always the current user, never trusted from the
// request body. Mostly meant to be called from other business-logic
// services as a side effect (e.g. after a project delete), not as its own
// primary end-user-facing CRUD surface, but exposed directly too for now.
@Injectable()
export class AuditEventsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authz: AuthzService,
  ) {}

  async log(
    userId: string,
    input: { workspaceId: string; action: string; targetType?: string; targetId?: string; metadataJson?: Record<string, unknown> },
  ) {
    const canView = await this.authz.hasWorkspaceRole(userId, input.workspaceId, "viewer");
    if (!canView) throw new ApiError(404, "Workspace not found");
    const [event] = await this.db
      .insert(auditEvents)
      .values({
        workspaceId: input.workspaceId,
        actorUserId: userId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadataJson: input.metadataJson ?? {},
      })
      .returning();
    return event;
  }

  async list(userId: string, workspaceId: string) {
    const canView = await this.authz.hasWorkspaceRole(userId, workspaceId, "viewer");
    if (!canView) throw new ApiError(404, "Workspace not found");
    return this.db.query.auditEvents.findMany({
      where: eq(auditEvents.workspaceId, workspaceId),
      orderBy: desc(auditEvents.createdAt),
    });
  }
}
