// @polar-sh/sdk publishes its versioned entrypoints (e.g. "./2027-01") only
// through package.json "exports" subpaths, which `moduleResolution: "node"`
// (classic) does not understand for *type* resolution - Node's own runtime
// resolver handles "exports" fine regardless, so this only affects tsc.
// Switching to "nodenext" to fix that instead broke drizzle-orm's own types
// (a dual-package-hazard clash between its "import"/"require" conditional
// exports) - a worse trade. This ambient shim sidesteps both: it's looked up
// by literal module-name string match, no file resolution involved, so it
// works under classic "node" resolution unchanged. Typed narrowly to just
// what apps/api/src/billing actually calls, not the full SDK surface.
declare module "@polar-sh/sdk/2027-01" {
  export interface PolarCheckout {
    url: string;
  }

  export interface PolarClient {
    checkouts: {
      create(input: {
        products: string[];
        amount: number;
        external_customer_id: string;
        customer_email?: string;
        success_url: string;
        metadata?: Record<string, unknown>;
      }): Promise<PolarCheckout>;
    };
  }

  export function createPolar(options: {
    accessToken: string;
    environment: "sandbox" | "production";
  }): PolarClient;

  export class PolarWebhookError extends Error {}
  export class PolarWebhookVerificationError extends PolarWebhookError {}
  export class PolarWebhookUnknownTypeError extends PolarWebhookError {
    eventType: string | null;
  }

  export const webhooks: {
    validateEvent(
      body: string | Uint8Array,
      headers: Record<string, string>,
      secret: string,
    ): Promise<{ type: string; data: Record<string, unknown> & { id: string } }>;
    PolarWebhookError: typeof PolarWebhookError;
    PolarWebhookVerificationError: typeof PolarWebhookVerificationError;
    PolarWebhookUnknownTypeError: typeof PolarWebhookUnknownTypeError;
  };
}
