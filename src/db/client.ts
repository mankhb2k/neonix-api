import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as authSchema from "./schema/auth";
import * as creditsSchema from "./schema/credits";
import * as payoutsSchema from "./schema/payouts";
import * as profileSchema from "./schema/profile";
import * as templatesSchema from "./schema/templates";
import * as topupsSchema from "./schema/topups";

export const pool = new Pool({ connectionString: env.databaseUrl });

export const schema = {
  ...authSchema,
  ...profileSchema,
  ...creditsSchema,
  ...payoutsSchema,
  ...templatesSchema,
  ...topupsSchema,
};

export const db = drizzle(pool, { schema });
export type Database = typeof db;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
