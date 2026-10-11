import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";
import { IapService } from "./iap.service";

class AppleNotificationDto {
  @IsString() @MinLength(10) signedPayload!: string;
}

@ApiTags("Webhooks")
@Controller("webhooks")
export class IapController {
  constructor(private readonly iap: IapService) {}

  // Unauthenticated by design: authenticity comes from Apple's JWS signature.
  @Post("apple")
  @HttpCode(200)
  @ApiOperation({ summary: "App Store Server Notifications V2 (refunds)" })
  async appleWebhook(@Body() body: AppleNotificationDto) {
    await this.iap.handleNotification(body.signedPayload);
    return { ok: true };
  }
}
