import { db } from "../db/client";
import { accountPlans, profiles, workspaceMembers, workspaces } from "../db/schema/identity";

// Replaces the former hosted-auth user provisioning trigger plus
// `handle_new_workspace()` on the resulting workspace insert - both were
// SQL/PLpgSQL triggers, now plain app code run from a Better Auth
// `databaseHooks.user.create.after` hook. Defensive against double-firing
// the same way the originals were (`on conflict do nothing` / `where not
// exists`), even though Better Auth should only call this once per real signup.
export async function provisionNewUser(user: { id: string; name: string; image?: string | null }) {
  await db.transaction(async (tx) => {
    await tx
      .insert(profiles)
      .values({ id: user.id, displayName: user.name, avatarUrl: user.image ?? null })
      .onConflictDoNothing();

    await tx.insert(accountPlans).values({ id: user.id }).onConflictDoNothing();

    const existingPersonalWorkspace = await tx.query.workspaces.findFirst({
      where: (workspace, { and, eq: eqOp }) =>
        and(eqOp(workspace.createdBy, user.id), eqOp(workspace.kind, "personal")),
    });

    if (!existingPersonalWorkspace) {
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name: "Personal workspace", createdBy: user.id, kind: "personal" })
        .returning({ id: workspaces.id });

      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
        .onConflictDoNothing();
    }
  });
}
