ALTER TABLE "template_exports" DROP CONSTRAINT "template_exports_user_key_unique";--> statement-breakpoint
ALTER TABLE "template_exports" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "template_exports" DROP COLUMN "idempotency_key";--> statement-breakpoint
DROP TYPE "public"."export_status";