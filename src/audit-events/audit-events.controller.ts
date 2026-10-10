import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ApiError } from "../common/api-error";
import { AuditEventsService } from "./audit-events.service";
import { CreateAuditEventDto } from "./dto/create-audit-event.dto";

@UseGuards(CurrentUserGuard)
@Controller("v1/audit-events")
export class AuditEventsController {
  constructor(private readonly auditEvents: AuditEventsService) {}

  @Post()
  async log(@CurrentUser() userId: string, @Body() dto: CreateAuditEventDto) {
    return { auditEvent: await this.auditEvents.log(userId, dto) };
  }

  @Get()
  async list(@CurrentUser() userId: string, @Query("workspaceId") workspaceId?: string) {
    if (!workspaceId) throw new ApiError(400, "workspaceId query param is required");
    return { auditEvents: await this.auditEvents.list(userId, workspaceId) };
  }
}
