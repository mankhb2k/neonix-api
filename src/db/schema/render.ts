import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects } from "./projects";
import { workspaces } from "./identity";
import { walletLedger } from "./misc";

// HTML frame-render export jobs. Not wired to a worker yet.

export const htmlRenderJobs = pgTable("html_render_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicRef: text("public_ref")
    .notNull()
    .unique()
    .default(sql`'hrj_' || encode(gen_random_bytes(10), 'hex')`),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  outputKey: text("output_key"),
  errorMessage: text("error_message"),
  // Filled in when a render finishes; drive the usage numbers in the dashboard.
  durationMs: integer("duration_ms"),
  fps: integer("fps"),
  costVnd: bigint("cost_vnd", { mode: "number" }),
  outputBytes: bigint("output_bytes", { mode: "number" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  check(
    "html_render_jobs_status_check",
    sql`${table.status} in ('queued', 'rendering', 'done', 'failed', 'cancelled')`,
  ),
  index("html_render_jobs_workspace_idx").on(table.workspaceId, table.createdAt.desc()),
  index("html_render_jobs_project_idx").on(table.projectId, table.createdAt.desc()),
]);

// Accounting ledger of every Cloud Run execution ("one machine started"): what it cost us and what the customer was
// charged. One row per execution. Rows outlive their job/project/workspace (foreign keys are SET NULL), because
// accounting history must not disappear when a customer deletes a project. Amounts are integers: USD in micro-dollars
// (1e-6 USD), VND in whole dong. The unit prices and the exchange rate used are stored on the row, so a row can always
// be re-computed and old rows stay correct when prices change. See docs/benchmarks/render-cost.md.
export const renderRuns = pgTable("render_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runKind: text("run_kind").notNull().default("customer"),
  status: text("status").notNull().default("succeeded"),
  // Links. Null for benchmark runs; kept as history when the job/project/workspace is deleted.
  htmlRenderJobId: uuid("html_render_job_id").references(() => htmlRenderJobs.id, { onDelete: "set null" }),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  walletLedgerId: uuid("wallet_ledger_id").references(() => walletLedger.id, { onDelete: "set null" }),
  // The machine
  provider: text("provider").notNull().default("cloud_run"),
  region: text("region").notNull().default("asia-southeast1"),
  executionName: text("execution_name").notNull().unique(),
  imageDigest: text("image_digest"),
  vcpu: integer("vcpu").notNull(),
  memoryGib: integer("memory_gib").notNull(),
  workers: integer("workers"),
  // What was rendered
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  fps: integer("fps").notNull(),
  videoMs: integer("video_ms").notNull(),
  outputBytes: bigint("output_bytes", { mode: "number" }),
  // Timings (Cloud Run execution times) and measurements
  createdAtRun: timestamp("run_created_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  billedMs: bigint("billed_ms", { mode: "number" }).notNull(),
  captureMs: bigint("capture_ms", { mode: "number" }),
  peakMemoryBytes: bigint("peak_memory_bytes", { mode: "number" }),
  // Price list used for the cost below
  vcpuSecondUsd: numeric("vcpu_second_usd", { precision: 14, scale: 10 }).notNull(),
  gibSecondUsd: numeric("gib_second_usd", { precision: 14, scale: 10 }).notNull(),
  egressUsdPerGib: numeric("egress_usd_per_gib", { precision: 10, scale: 6 }).notNull(),
  usdVndRate: numeric("usd_vnd_rate", { precision: 12, scale: 2 }).notNull(),
  // Our cost
  computeCostUsdMicros: bigint("compute_cost_usd_micros", { mode: "number" }).notNull(),
  egressCostUsdMicros: bigint("egress_cost_usd_micros", { mode: "number" }).notNull(),
  storageCostUsdMicros: bigint("storage_cost_usd_micros", { mode: "number" }).notNull().default(0),
  totalCostUsdMicros: bigint("total_cost_usd_micros", { mode: "number" }).notNull(),
  costVnd: bigint("cost_vnd", { mode: "number" }).notNull(),
  // What the customer paid for it (0 for benchmark runs), and the gross profit of this run
  priceVnd: bigint("price_vnd", { mode: "number" }).notNull().default(0),
  grossProfitVnd: bigint("gross_profit_vnd", { mode: "number" }).generatedAlwaysAs(sql`price_vnd - cost_vnd`),
  metadata: jsonb("metadata").notNull().default({}),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("render_runs_kind_check", sql`${table.runKind} in ('customer', 'benchmark')`),
  check("render_runs_status_check", sql`${table.status} in ('succeeded', 'failed', 'cancelled')`),
  check(
    "render_runs_amounts_check",
    sql`${table.priceVnd} >= 0 and ${table.costVnd} >= 0 and ${table.totalCostUsdMicros} >= 0 and ${table.billedMs} >= 0`,
  ),
  check(
    "render_runs_total_check",
    sql`${table.totalCostUsdMicros} = ${table.computeCostUsdMicros} + ${table.egressCostUsdMicros} + ${table.storageCostUsdMicros}`,
  ),
  index("render_runs_started_idx").on(table.startedAt.desc()),
  index("render_runs_workspace_idx").on(table.workspaceId, table.startedAt.desc()),
  index("render_runs_job_idx").on(table.htmlRenderJobId),
  index("render_runs_kind_idx").on(table.runKind, table.startedAt.desc()),
]);
