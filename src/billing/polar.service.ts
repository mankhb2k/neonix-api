import { Injectable } from "@nestjs/common";
import { createPolar } from "@polar-sh/sdk/2027-01";

type PolarClient = ReturnType<typeof createPolar>;
type PolarEnvironment = "sandbox" | "production";

function resolveEnvironment(): PolarEnvironment {
  const raw = process.env.POLAR_ENVIRONMENT?.trim().toLowerCase();
  return raw === "production" ? "production" : "sandbox";
}

// Real, billed Polar API calls - never call this from an automated test.
// Tests override this provider instead.
@Injectable()
export class PolarService {
  private client: PolarClient | null = null;

  private getClient(): PolarClient {
    if (this.client) return this.client;
    const accessToken = process.env.POLAR_ACCESS_TOKEN?.trim();
    if (!accessToken) throw new Error("Missing POLAR_ACCESS_TOKEN");
    this.client = createPolar({ accessToken, environment: resolveEnvironment() });
    return this.client;
  }

  private getTopupProductId(): string {
    const productId = process.env.POLAR_TOPUP_PRODUCT_ID?.trim();
    if (!productId) throw new Error("Missing POLAR_TOPUP_PRODUCT_ID");
    return productId;
  }

  async createTopupCheckout(input: {
    userId: string;
    email?: string;
    amountCents: number;
    successUrl: string;
    /** Origin of the page that embeds the checkout iframe, so Polar allows it. */
    embedOrigin?: string;
  }): Promise<{ url: string }> {
    const checkout = await this.getClient().checkouts.create({
      products: [this.getTopupProductId()],
      amount: input.amountCents,
      external_customer_id: input.userId,
      customer_email: input.email,
      success_url: input.successUrl,
      ...(input.embedOrigin ? { embed_origin: input.embedOrigin } : {}),
      metadata: { userId: input.userId, kind: "wallet_topup" },
    });
    return { url: checkout.url };
  }
}
