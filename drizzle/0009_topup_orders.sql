CREATE TABLE "topup_orders" (
	"order_code" bigint PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"credits" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_link_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "topup_orders_amount_vnd_check" CHECK ("topup_orders"."amount_vnd" > 0),
	CONSTRAINT "topup_orders_credits_check" CHECK ("topup_orders"."credits" > 0),
	CONSTRAINT "topup_orders_status_check" CHECK ("topup_orders"."status" in ('pending', 'paid', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "topup_orders" ADD CONSTRAINT "topup_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topup_orders_user_created_idx" ON "topup_orders" USING btree ("user_id","created_at" DESC NULLS LAST);