import { Controller, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { PayosService, verifyPayosSignature } from "./payos.service";
import { TopupsService } from "./topups.service";

// payOS posts JSON ({ code, success, data, signature }); the signature covers the sorted fields of `data`, so the
// parsed body is enough. Credits are granted only for a validly signed, paid order of ours.
@ApiExcludeController()
@Controller()
export class PayosWebhookController {
  constructor(
    private readonly payos: PayosService,
    private readonly topups: TopupsService,
  ) {}

  @Post("webhooks/payos")
  async handle(@Req() req: Request, @Res() res: Response) {
    const checksumKey = this.payos.getChecksumKey();
    if (!checksumKey) {
      res.status(503).json({ error: "webhook_not_configured" });
      return;
    }
    const body = req.body as { code?: string; data?: Record<string, unknown>; signature?: string } | undefined;
    if (!body?.data || typeof body.signature !== "string" || !verifyPayosSignature(checksumKey, body.data, body.signature)) {
      res.status(403).json({ error: "invalid_signature" });
      return;
    }
    const orderCode = Number(body.data.orderCode);
    const amount = Number(body.data.amount);
    // payOS sends a confirmation ping with a made-up order code when the webhook URL is saved; acknowledge
    // anything that isn't a paid order of ours.
    if (body.code !== "00" || !Number.isSafeInteger(orderCode)) {
      res.status(200).json({ received: true });
      return;
    }
    try {
      await this.topups.settle(orderCode, Number.isFinite(amount) ? amount : undefined);
    } catch (error) {
      console.error("[webhooks/payos] failed to credit", error);
      res.status(500).json({ error: "ledger_write_failed" });
      return;
    }
    res.status(200).json({ received: true });
  }
}
