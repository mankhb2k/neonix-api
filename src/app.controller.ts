import { ApiTags } from "@nestjs/swagger";
import { Controller, Get } from "@nestjs/common";

@ApiTags("System")
@Controller()
export class AppController {
  @Get("healthz")
  healthz() {
    return { status: "ok" };
  }
}
