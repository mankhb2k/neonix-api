import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { db, schema } from "../db/client";
import { env } from "../env";
import { provisionNewUser } from "./provision";

export const auth = betterAuth({
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,
  trustedOrigins: [env.webAppUrl, ...env.additionalTrustedOrigins],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
    },
  },
  // api.neonix.video and app.neonix.video are sibling subdomains - without
  // this, Better Auth's session cookie is scoped to api.neonix.video only
  // and apps/web can never see it. No-op in local dev (cookieDomain unset,
  // both sides are on localhost anyway).
  advanced: env.cookieDomain
    ? { crossSubDomainCookies: { enabled: true, domain: env.cookieDomain } }
    : undefined,
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await provisionNewUser(user);
        },
      },
    },
  },
  plugins: [
    // jwt() signs OAuth id/access tokens for the mcp() provider below. By
    // default it also signs a JWT on every /get-session and returns it in a
    // `set-auth-jwt` header - nothing here reads it, and it makes plain session
    // reads fail with an empty 500 if the jwks keys can't be loaded/decrypted.
    jwt({ disableSettingJwtHeader: true }),
    // Makes this server a standalone OAuth 2.1 authorization server for MCP
    // clients (Claude Desktop, ChatGPT/Codex/Glama connectors, etc.),
    // replacing the role the former hosted OAuth server played for the web
    // separate/older MCP endpoint today. loginPage/consentPage are full
    // cross-origin URLs (apps/web, not apps/api - this server has no HTML
    // pages of its own): the oauth-provider plugin does plain string
    // concatenation for these, not path resolution, so an absolute URL
    // here redirects the browser to the right host.
    mcp({
      loginPage: `${env.webAppUrl}/mcp/sign-in`,
      consentPage: `${env.webAppUrl}/mcp/consent`,
      resource: `${env.betterAuthUrl}/mcp`,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
  ],
});
