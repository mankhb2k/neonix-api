import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { AccountService } from "./account.service";

@UseGuards(CurrentUserGuard)
@Controller("v1/account")
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get("storage")
  async storage(@CurrentUser() userId: string) {
    return this.account.getStorageUsage(userId);
  }
}
