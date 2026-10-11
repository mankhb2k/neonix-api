import { db } from "../db/client";
import { creditWallets } from "../db/schema/credits";
import { profiles } from "../db/schema/profile";

// Runs from Better Auth's `user.create.after` hook. Idempotent on purpose.
export async function provisionNewUser(user: { id: string; name: string }) {
  await db.transaction(async (tx) => {
    await tx.insert(profiles).values({ id: user.id, displayName: user.name }).onConflictDoNothing();
    await tx.insert(creditWallets).values({ userId: user.id }).onConflictDoNothing();
  });
}
