ALTER TABLE "template_exports" ADD COLUMN "client_project_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "template_exports" ADD COLUMN "reexport_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "template_exports" ADD COLUMN "last_reexport_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "template_exports_window_idx" ON "template_exports" USING btree ("user_id","template_id","client_project_id","created_at");