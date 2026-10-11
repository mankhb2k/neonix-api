import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { db, schema } from "../db/client";
import { env } from "../env";
import { provisionNewUser } from "./provision";

// The iOS app signs in natively (Apple/Google id token → POST
// /api/auth/sign-in/social) and keeps the session token from the
// `set-auth-token` response header, sending it as `Authorization: Bearer`.
export const auth = betterAuth({
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,
  trustedOrigins: [env.betterAuthUrl],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Sign-in is Google + Apple only; no email/password.
  emailAndPassword: { enabled: false },
  socialProviders: {
    google: { clientId: env.googleClientId, clientSecret: env.googleClientSecret },
    ...(env.appleClientId && env.appleClientSecret
      ? { apple: { clientId: env.appleClientId, clientSecret: env.appleClientSecret, appBundleIdentifier: env.appBundleId } }
      : {}),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await provisionNewUser(user);
        },
      },
    },
  },
  plugins: [bearer()],
});
