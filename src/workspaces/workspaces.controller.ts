import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { RenameWorkspaceDto } from "./dto/rename-workspace.dto";
import { WorkspacesService } from "./workspaces.service";

@UseGuards(CurrentUserGuard)
@Controller("v1/workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  async list(@CurrentUser() userId: string) {
    return { workspaces: await this.workspaces.listForUser(userId) };
  }

  @Get(":id")
  async get(@CurrentUser() userId: string, @Param("id") id: string) {
    return { workspace: await this.workspaces.getForMember(userId, id) };
  }

  @Patch(":id")
  async rename(@CurrentUser() userId: string, @Param("id") id: string, @Body() dto: RenameWorkspaceDto) {
    return { workspace: await this.workspaces.rename(userId, id, dto.name) };
  }
}
