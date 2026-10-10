import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";

@Controller()
export class AppController {
  @Get("healthz")
  healthz() {
    return { status: "ok" };
  }

  @Get(".well-known/glama.json")
  glamaChallenge(@Res() response: Response) {
    const claim = process.env.GLAMA_CLAIM_TOKEN?.trim() || "glama_claim_bqFczvOnRE0bauJrz2n4gQaU7hkcjkKW";
    return response
      .status(200)
      .set({ "Cache-Control": "public, max-age=3600", "Content-Type": "application/json; charset=utf-8" })
      .send(JSON.stringify({
        $schema: "https://glama.ai/mcp/schemas/connector.json",
        claim,
      }));
  }

  @Get(".well-known/openai-apps-challenge")
  openAiAppsChallenge(@Res() response: Response) {
    const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
    if (!token) {
      return response
        .status(404)
        .set({ "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" })
        .send("Challenge token is not configured");
    }
    return response
      .status(200)
      .set({ "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" })
      .send(token);
  }
}
