ALTER TYPE "public"."ledger_reason" ADD VALUE 'template_purchase';--> statement-breakpoint
CREATE TABLE "template_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"template_id" uuid,
	"version_id" uuid,
	"credits_charged" integer NOT NULL,
	"creator_id" text,
	"creator_earning_vnd" integer DEFAULT 0 NOT NULL,
	"payout_id" uuid,
	"export_count" integer DEFAULT 1 NOT NULL,
	"last_exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_purchases_user_template_unique" UNIQUE("user_id","template_id")
);
--> statement-breakpoint
ALTER TABLE "template_purchases" ADD CONSTRAINT "template_purchases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_purchases" ADD CONSTRAINT "template_purchases_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_purchases" ADD CONSTRAINT "template_purchases_version_id_template_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."template_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_purchases" ADD CONSTRAINT "template_purchases_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_purchases" ADD CONSTRAINT "template_purchases_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_purchases_template_idx" ON "template_purchases" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "template_purchases_creator_idx" ON "template_purchases" USING btree ("creator_id","payout_id");