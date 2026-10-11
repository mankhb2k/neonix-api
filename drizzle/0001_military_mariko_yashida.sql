ALTER TABLE "template_versions" ADD COLUMN "slot_count" integer;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_package_key_unique" UNIQUE("package_key");