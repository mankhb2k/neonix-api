import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import type { Database } from "../db/client";
import { db, schema } from "../db/client";
import { env } from "../env";
import { provisionNewUser } from "./provision";

// The ids of the apps that may sign in through the browser (device authorization), and the name the approval page shows for each.
export const deviceClients: Record<string, string> = { "neonix-desktop": "Neonix Desktop" };

// The iOS app signs in natively (Apple/Google id token → POST
// /api/auth/sign-in/social) and keeps the session token from the
// `set-auth-token` response header, sending it as `Authorization: Bearer`.
// The desktop app starts the sign-in in the browser (POST /api/auth/device/code, the page at /device) and polls
// POST /api/auth/device/token, whose `access_token` is a session token used the same way.
export function createAuth(database: Database) {
  return betterAuth({
    secret: env.betterAuthSecret,
    baseURL: env.betterAuthUrl,
    trustedOrigins: [env.betterAuthUrl, ...env.webOrigins],
    // Behind Cloudflare (the only source the server accepts on port 80) the client's address is in cf-connecting-ip; without it the rate limits
    // (the device page allows few tries) would be one bucket shared by every user.
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    database: drizzleAdapter(database, { provider: "pg", schema }),
    // Email/password is used by the iOS sign-in and account-creation form.
    // Better Auth hashes passwords before persisting them in the credential account.
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
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
    plugins: [bearer(), deviceAuthorization({ verificationUri: "/device", validateClient: (clientId) => clientId in deviceClients })],
  });
}

export const auth = createAuth(db);
