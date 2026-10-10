import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../env";
import * as assetsSchema from "./schema/assets";
import * as apiKeysSchema from "./schema/api-keys";
import * as authSchema from "./schema/auth";
import * as fontsSchema from "./schema/fonts";
import * as identitySchema from "./schema/identity";
import * as miscSchema from "./schema/misc";
import * as oauthProviderSchema from "./schema/oauth-provider";
import * as projectsSchema from "./schema/projects";
import * as renderSchema from "./schema/render";
import * as systemCatalogSchema from "./schema/system-catalog";

// Plain TCP `pg` pool, not @neondatabase/serverless's HTTP driver - this
// process is a persistent Docker server, not an edge/serverless function, so
// there's no benefit to the fetch-based driver. Neon's pooled connection
// string works with this the same as any other Postgres host.
export const pool = new Pool({ connectionString: env.databaseUrl });

export const schema = {
  ...authSchema,
  ...apiKeysSchema,
  ...identitySchema,
  ...projectsSchema,
  ...assetsSchema,
  ...fontsSchema,
  ...miscSchema,
  ...oauthProviderSchema,
  ...renderSchema,
  ...systemCatalogSchema,
};

export const db = drizzle(pool, { schema });
export type Database = typeof db;
