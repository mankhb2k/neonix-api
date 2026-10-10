ALTER TABLE "topup_orders" ADD COLUMN "credited_vnd" bigint;--> statement-breakpoint
UPDATE "topup_orders" SET "credited_vnd" = "amount_vnd";--> statement-breakpoint
ALTER TABLE "topup_orders" ALTER COLUMN "credited_vnd" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD COLUMN "amount_vnd" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_amount_vnd_check" CHECK ("wallet_ledger"."amount_vnd" <> 0);