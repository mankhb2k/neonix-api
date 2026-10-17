function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

// Dev-only: lets requests act as any user via `X-Dev-User`, skipping sign-in. Refused in production.
const devAuthBypass = process.env.DEV_AUTH_BYPASS?.trim() === "true";
if (devAuthBypass && process.env.NODE_ENV === "production") {
  throw new Error("DEV_AUTH_BYPASS must never be enabled in production");
}

export const env = {
  devAuthBypass,
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required("DATABASE_URL"),
  betterAuthSecret: required("BETTER_AUTH_SECRET"),
  betterAuthUrl: optional("BETTER_AUTH_URL") ?? `http://localhost:${process.env.PORT ?? 8080}`,
  appBundleId: optional("APP_BUNDLE_ID") ?? "com.neonix.editor",
  appleAppId: optional("APPLE_APP_ID") ? Number(optional("APPLE_APP_ID")) : undefined,
  // Apple sign-in is enabled only when both are set (Google first, Apple later).
  appleClientId: optional("APPLE_CLIENT_ID"),
  appleClientSecret: optional("APPLE_CLIENT_SECRET"),
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  // Starting values for new templates; the admin can change them per template.
  defaultExportCredits: Number(optional("DEFAULT_EXPORT_CREDITS") ?? 6),
  defaultCreatorEarningVnd: Number(optional("DEFAULT_CREATOR_EARNING_VND") ?? 0),
  // Browser origins allowed to call this API with cookies (the Neonix website). Comma separated; the first is the default
  // return address for payOS.
  webOrigins: (optional("WEB_ORIGINS") ?? "http://localhost:3000").split(",").map((origin) => origin.trim().replace(/\/+$/, "")).filter(Boolean),
  // Web top-ups (payOS). All three must be set for /v1/billing/payos/* to work; the API boots without them.
  payosClientId: optional("PAYOS_CLIENT_ID"),
  payosApiKey: optional("PAYOS_API_KEY"),
  payosChecksumKey: optional("PAYOS_CHECKSUM_KEY"),
  // Price of one credit on the web: 1.000 VND buys 10 credits, so one credit is 100 VND.
  vndPerCredit: Number(optional("VND_PER_CREDIT") ?? 100),
  // A creator is paid once the unpaid purchases of their templates reach this many; below it they keep accumulating.
  payoutMinPurchases: Number(optional("PAYOUT_MIN_PURCHASES") ?? 100),
};
