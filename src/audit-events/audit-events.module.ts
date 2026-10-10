import { Module } from "@nestjs/common";
import { AuthzModule } from "../authz/authz.module";
import { AuditEventsController } from "./audit-events.controller";
import { AuditEventsService } from "./audit-events.service";

@Module({
  imports: [AuthzModule],
  controllers: [AuditEventsController],
  providers: [AuditEventsService],
})
export class AuditEventsModule {}
