CREATE TABLE "apple_notifications" (
	"notification_uuid" text PRIMARY KEY NOT NULL,
	"notification_type" text NOT NULL,
	"subtype" text,
	"transaction_id" text,
	"environment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_packs" (
	"product_id" text PRIMARY KEY NOT NULL,
	"credits" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_packs_credits_check" CHECK ("credit_packs"."credits" > 0)
);
--> statement-breakpoint
CREATE INDEX "apple_notifications_transaction_idx" ON "apple_notifications" USING btree ("transaction_id");