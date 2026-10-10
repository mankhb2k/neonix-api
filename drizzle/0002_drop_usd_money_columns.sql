ALTER TABLE "wallet_ledger" DROP CONSTRAINT "wallet_ledger_amount_cents_check";--> statement-breakpoint
ALTER TABLE "topup_orders" DROP COLUMN "credited_cents";--> statement-breakpoint
ALTER TABLE "wallet_ledger" DROP COLUMN "amount_cents";--> statement-breakpoint
ALTER TABLE "wallet_ledger" DROP COLUMN "currency";