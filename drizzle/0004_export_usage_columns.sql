ALTER TABLE "html_render_jobs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "html_render_jobs" ADD COLUMN "fps" integer;--> statement-breakpoint
ALTER TABLE "html_render_jobs" ADD COLUMN "cost_vnd" bigint;--> statement-breakpoint
ALTER TABLE "html_render_jobs" ADD COLUMN "output_bytes" bigint;