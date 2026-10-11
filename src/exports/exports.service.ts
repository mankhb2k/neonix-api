import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { ApiError } from "../common/api-error";
import { CreditsService } from "../credits/credits.service";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { templatePurchases, templateVersions, templates } from "../db/schema/templates";

// Export itself runs on the user's device. The server only decides whether it is paid for.
//
// A template is bought once, by its first export: the template's credit price is spent and the template is
// the user's for good - every later export of it, of any project, is free. (Pro add-ons will be separate
// purchases on top, not a per-export fee.) The package download itself is always free
// (GET /v1/templates/:id/package): people must be able to open a template before paying for it.
@Injectable()
export class ExportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly credits: CreditsService,
  ) {}

  /**
   * Call right before rendering. Owned template: free, just counted. Not owned yet: spends the credits and
   * records the purchase in one transaction (not enough credits = 402, nothing recorded). Safe to retry and
   * to double-tap: the wallet lock serializes requests per user, so the second call sees the purchase.
   */
  async create(userId: string, input: { templateId: string; versionId?: string }) {
    return this.db.transaction(async (tx) => {
      await this.credits.lockWallet(tx, userId);

      const [owned] = await tx
        .update(templatePurchases)
        .set({ exportCount: sql`${templatePurchases.exportCount} + 1`, lastExportedAt: new Date() })
        .where(and(eq(templatePurchases.userId, userId), eq(templatePurchases.templateId, input.templateId)))
        .returning({ id: templatePurchases.id });
      if (owned) {
        return { purchaseId: owned.id, owned: true, charged: false, creditsCharged: 0, balance: await this.credits.getBalance(userId) };
      }

      const template = await tx.query.templates.findFirst({ where: eq(templates.id, input.templateId) });
      if (!template || template.status !== "published" || !template.currentVersionId) throw new ApiError(404, "Template not found");
      // The project may have been started from an older version; it must still be an approved one of this template.
      const version = await tx.query.templateVersions.findFirst({
        where: and(
          eq(templateVersions.id, input.versionId ?? template.currentVersionId),
          eq(templateVersions.templateId, input.templateId),
          eq(templateVersions.status, "approved"),
        ),
      });
      if (!version) throw new ApiError(404, "Version not found");

      const [purchase] = await tx
        .insert(templatePurchases)
        .values({
          userId,
          templateId: input.templateId,
          versionId: version.id,
          creditsCharged: template.creditCost,
          creatorId: template.creatorId,
          creatorEarningVnd: template.creatorEarningVnd,
        })
        .returning();
      const { balance } =
        template.creditCost > 0
          ? await this.credits.applyDelta(tx, {
              userId,
              delta: -template.creditCost,
              reason: "template_purchase",
              refId: purchase.id,
              idempotencyKey: `template-purchase:${purchase.id}`,
            })
          : { balance: await this.credits.getBalance(userId) };
      // use_count = how many users own the template.
      await tx.update(templates).set({ useCount: sql`${templates.useCount} + 1` }).where(eq(templates.id, input.templateId));

      return { purchaseId: purchase.id, owned: true, charged: true, creditsCharged: template.creditCost, balance };
    });
  }
}
