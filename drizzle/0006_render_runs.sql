CREATE TABLE "render_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_kind" text DEFAULT 'customer' NOT NULL,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"html_render_job_id" uuid,
	"workspace_id" uuid,
	"project_id" uuid,
	"wallet_ledger_id" uuid,
	"provider" text DEFAULT 'cloud_run' NOT NULL,
	"region" text DEFAULT 'asia-southeast1' NOT NULL,
	"execution_name" text NOT NULL,
	"image_digest" text,
	"vcpu" integer NOT NULL,
	"memory_gib" integer NOT NULL,
	"workers" integer,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"fps" integer NOT NULL,
	"video_ms" integer NOT NULL,
	"output_bytes" bigint,
	"run_created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"billed_ms" bigint NOT NULL,
	"capture_ms" bigint,
	"peak_memory_bytes" bigint,
	"vcpu_second_usd" numeric(14, 10) NOT NULL,
	"gib_second_usd" numeric(14, 10) NOT NULL,
	"egress_usd_per_gib" numeric(10, 6) NOT NULL,
	"usd_vnd_rate" numeric(12, 2) NOT NULL,
	"compute_cost_usd_micros" bigint NOT NULL,
	"egress_cost_usd_micros" bigint NOT NULL,
	"storage_cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"total_cost_usd_micros" bigint NOT NULL,
	"cost_vnd" bigint NOT NULL,
	"price_vnd" bigint DEFAULT 0 NOT NULL,
	"gross_profit_vnd" bigint GENERATED ALWAYS AS (price_vnd - cost_vnd) STORED,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "render_runs_execution_name_unique" UNIQUE("execution_name"),
	CONSTRAINT "render_runs_kind_check" CHECK ("render_runs"."run_kind" in ('customer', 'benchmark')),
	CONSTRAINT "render_runs_status_check" CHECK ("render_runs"."status" in ('succeeded', 'failed', 'cancelled')),
	CONSTRAINT "render_runs_amounts_check" CHECK ("render_runs"."price_vnd" >= 0 and "render_runs"."cost_vnd" >= 0 and "render_runs"."total_cost_usd_micros" >= 0 and "render_runs"."billed_ms" >= 0),
	CONSTRAINT "render_runs_total_check" CHECK ("render_runs"."total_cost_usd_micros" = "render_runs"."compute_cost_usd_micros" + "render_runs"."egress_cost_usd_micros" + "render_runs"."storage_cost_usd_micros")
);
--> statement-breakpoint
ALTER TABLE "render_runs" ADD CONSTRAINT "render_runs_html_render_job_id_html_render_jobs_id_fk" FOREIGN KEY ("html_render_job_id") REFERENCES "public"."html_render_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_runs" ADD CONSTRAINT "render_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_runs" ADD CONSTRAINT "render_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_runs" ADD CONSTRAINT "render_runs_wallet_ledger_id_wallet_ledger_id_fk" FOREIGN KEY ("wallet_ledger_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "render_runs_started_idx" ON "render_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "render_runs_workspace_idx" ON "render_runs" USING btree ("workspace_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "render_runs_job_idx" ON "render_runs" USING btree ("html_render_job_id");--> statement-breakpoint
CREATE INDEX "render_runs_kind_idx" ON "render_runs" USING btree ("run_kind","started_at" DESC NULLS LAST);