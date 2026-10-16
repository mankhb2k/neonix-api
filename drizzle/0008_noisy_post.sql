ALTER TABLE "template_purchases" DROP CONSTRAINT "template_purchases_payout_id_payouts_id_fk";
--> statement-breakpoint
ALTER TABLE "template_purchases" ADD CONSTRAINT "template_purchases_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE restrict ON UPDATE no action;