import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error";

const PAYOS_BASE_URL = "https://api-merchant.payos.vn";

export interface PayosPaymentLink {
  paymentLinkId: string;
  checkoutUrl: string;
  qrCode: string;
  accountNumber: string;
  accountName: string;
  bin: string;
  amount: number;
  description: string;
}

export type PayosPaymentStatus = "PENDING" | "PROCESSING" | "PAID" | "CANCELLED" | "EXPIRED" | "UNDERPAID";

function hmacHex(key: string, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

// payOS signs a webhook by joining the `data` object's fields as
// `key=value`, sorted by key, with `&` - null/undefined become "".
export function payosDataSignature(checksumKey: string, data: Record<string, unknown>): string {
  const payload = Object.keys(data)
    .sort()
    .map((key) => {
      const value = data[key];
      const text = value === null || value === undefined || value === "null" || value === "undefined"
        ? ""
        : typeof value === "object" ? JSON.stringify(value) : String(value);
      return `${key}=${text}`;
    })
    .join("&");
  return hmacHex(checksumKey, payload);
}

export function verifyPayosSignature(checksumKey: string, data: Record<string, unknown>, signature: string): boolean {
  const expected = Buffer.from(payosDataSignature(checksumKey, data));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// Real payOS API calls - tests override this provider instead.
@Injectable()
export class PayosService {
  private credentials(): { clientId: string; apiKey: string; checksumKey: string } {
    const clientId = process.env.PAYOS_CLIENT_ID?.trim();
    const apiKey = process.env.PAYOS_API_KEY?.trim();
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim();
    if (!clientId || !apiKey || !checksumKey) {
      throw new ApiError(503, "VND payments are not configured", "payos_not_configured");
    }
    return { clientId, apiKey, checksumKey };
  }

  getChecksumKey(): string | null {
    return process.env.PAYOS_CHECKSUM_KEY?.trim() || null;
  }

  async createPaymentLink(input: {
    orderCode: number;
    amountVnd: number;
    description: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<PayosPaymentLink> {
    const { clientId, apiKey, checksumKey } = this.credentials();
    const signature = hmacHex(
      checksumKey,
      `amount=${input.amountVnd}&cancelUrl=${input.cancelUrl}&description=${input.description}&orderCode=${input.orderCode}&returnUrl=${input.returnUrl}`,
    );
    const response = await fetch(`${PAYOS_BASE_URL}/v2/payment-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-id": clientId, "x-api-key": apiKey },
      body: JSON.stringify({
        orderCode: input.orderCode,
        amount: input.amountVnd,
        description: input.description,
        items: [{ name: "Neonix balance top-up", quantity: 1, price: input.amountVnd }],
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        signature,
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      code?: string;
      desc?: string;
      data?: Partial<PayosPaymentLink> | null;
    } | null;
    const data = body?.data;
    if (!response.ok || body?.code !== "00" || !data?.paymentLinkId || !data.qrCode || !data.checkoutUrl) {
      console.error("[payos] create payment link failed", { status: response.status, code: body?.code, desc: body?.desc });
      throw new ApiError(502, "Couldn't create the payment QR code", "payos_create_failed");
    }
    return {
      paymentLinkId: data.paymentLinkId,
      checkoutUrl: data.checkoutUrl,
      qrCode: data.qrCode,
      accountNumber: data.accountNumber ?? "",
      accountName: data.accountName ?? "",
      bin: data.bin ?? "",
      amount: data.amount ?? input.amountVnd,
      // payOS may rewrite the description (for example prefixing a bank
      // code); the QR carries the final one, so show that.
      description: data.description || input.description,
    };
  }

  // Server-side status check, so a payment is credited even when the webhook
  // can't reach this API (for example on localhost).
  async getPaymentStatus(orderCode: number): Promise<PayosPaymentStatus | null> {
    const { clientId, apiKey } = this.credentials();
    const response = await fetch(`${PAYOS_BASE_URL}/v2/payment-requests/${orderCode}`, {
      headers: { "x-client-id": clientId, "x-api-key": apiKey },
    });
    const body = (await response.json().catch(() => null)) as { code?: string; data?: { status?: string } | null } | null;
    if (!response.ok || body?.code !== "00") return null;
    return (body.data?.status as PayosPaymentStatus | undefined) ?? null;
  }
}
