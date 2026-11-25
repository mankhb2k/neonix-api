import { Controller, Get, Header } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { devicePageHtml } from "./device-page";

// The page of the desktop sign-in (see device-page.ts). It must never be framed: a page that approves a sign-in with one click is what a clickjacking attack aims at.
@ApiExcludeController()
@Controller()
export class DeviceController {
  @Get("device")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-store")
  @Header("X-Frame-Options", "DENY")
  @Header("Referrer-Policy", "no-referrer")
  @Header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
  page() {
    return devicePageHtml();
  }
}
