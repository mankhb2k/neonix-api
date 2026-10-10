function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required("DATABASE_URL"),
  betterAuthSecret: required("BETTER_AUTH_SECRET"),
  betterAuthUrl: process.env.BETTER_AUTH_URL?.trim() || `http://localhost:${process.env.PORT ?? 8080}`,
  webAppUrl: process.env.WEB_APP_URL?.trim() || "http://localhost:3000",
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  // Comma-separated list of additional origins (marketing site, preview
  // deployments) allowed to call the API/auth endpoints with credentials,
  // beyond webAppUrl itself. See auth.ts's trustedOrigins/CORS wiring.
  additionalTrustedOrigins: (process.env.ADDITIONAL_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  // The registrable domain shared by api.neonix.video and app.neonix.video,
  // used for Better Auth's cross-subdomain session cookie. Empty in local
  // dev (both sides are on localhost, no shared parent domain to scope to).
  cookieDomain: process.env.COOKIE_DOMAIN?.trim() || undefined,
};
