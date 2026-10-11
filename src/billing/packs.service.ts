import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { DATABASE } from "../db/database.module";
import { creditPacks } from "../db/schema/credits";

@Injectable()
export class PacksService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** What the shop shows. Price text comes from StoreKit by `productId`. */
  async listActive() {
    const rows = await this.db.select().from(creditPacks).where(eq(creditPacks.active, true)).orderBy(asc(creditPacks.sortOrder), asc(creditPacks.credits));
    return { items: rows.map((r) => ({ productId: r.productId, credits: r.credits })) };
  }

  async listAll() {
    return { items: await this.db.select().from(creditPacks).orderBy(asc(creditPacks.sortOrder), asc(creditPacks.credits)) };
  }

  async upsert(productId: string, input: { credits: number; active?: boolean; sortOrder?: number }) {
    const values = { credits: input.credits, active: input.active ?? true, sortOrder: input.sortOrder ?? 0, updatedAt: new Date() };
    const [row] = await this.db
      .insert(creditPacks)
      .values({ productId, ...values })
      .onConflictDoUpdate({ target: creditPacks.productId, set: values })
      .returning();
    return row;
  }
}
