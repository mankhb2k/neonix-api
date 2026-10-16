// Dev seed: stable accounts to try the app and the API with `DEV_AUTH_BYPASS`. Safe to re-run.
//   pnpm build && pnpm db:seed
// The iOS app acts as `dev-ios` by default (NeonixAPIClient); roles stick, so the app needs no X-Dev-Role header.
import { ensureDevUser } from "../auth/dev-auth";
import { CreditsService } from "../credits/credits.service";
import { db, pool } from "../db/client";
import { creditPacks } from "../db/schema/credits";
import { creatorPayoutAccounts } from "../db/schema/payouts";
import { env } from "../env";

const ACCOUNTS = [
  { id: "dev-ios", role: "user", credits: 500 },
  { id: "dev-creator", role: "creator", credits: 100 },
  { id: "dev-admin", role: "admin", credits: 100 },
] as const;

// Same product ids as ios-editor/StoreKit/Credits.storekit; in App Store Connect create them as Consumables.
const PACKS = [
  { productId: "com.neonix.editor.credits.50", credits: 50, sortOrder: 1 },
  { productId: "com.neonix.editor.credits.120", credits: 120, sortOrder: 2 },
  { productId: "com.neonix.editor.credits.300", credits: 300, sortOrder: 3 },
];

async function main() {
  if (process.env.NODE_ENV === "production" || !env.devAuthBypass) {
    throw new Error("Refusing to seed: needs DEV_AUTH_BYPASS=true and NODE_ENV != production");
  }
  const credits = new CreditsService(db);
  for (const account of ACCOUNTS) {
    await ensureDevUser(account.id, account.role);
    // Fixed idempotency key: re-running never adds credits twice.
    const { balance } = await db.transaction((tx) =>
      credits.applyDelta(tx, { userId: account.id, delta: account.credits, reason: "grant", idempotencyKey: `seed:${account.id}:initial` }),
    );
    console.log(`${account.id}  role=${account.role}  credits=${balance}`);
  }
  // A fake bank account so the creator shows up in the weekly payout run.
  const values = { bankName: "Vietcombank", accountNumber: "0123456789", accountHolder: "DEV CREATOR", updatedAt: new Date() };
  await db.insert(creatorPayoutAccounts).values({ userId: "dev-creator", ...values }).onConflictDoUpdate({ target: creatorPayoutAccounts.userId, set: values });
  console.log("dev-creator  payout account set");
  for (const pack of PACKS) {
    await db.insert(creditPacks).values(pack).onConflictDoUpdate({ target: creditPacks.productId, set: { credits: pack.credits, sortOrder: pack.sortOrder } });
  }
  console.log(`credit packs: ${PACKS.map((p) => p.credits).join(", ")}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
