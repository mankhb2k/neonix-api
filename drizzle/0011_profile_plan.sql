CREATE TYPE "public"."user_plan" AS ENUM('free_trial', 'lifetime');--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "plan" "user_plan" DEFAULT 'free_trial' NOT NULL;