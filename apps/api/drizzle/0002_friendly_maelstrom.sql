CREATE TYPE "public"."business_scale" AS ENUM('micro', 'small', 'medium');--> statement-breakpoint
ALTER TYPE "public"."signal_type" ADD VALUE 'expansion';--> statement-breakpoint
ALTER TYPE "public"."signal_type" ADD VALUE 'second_branch';--> statement-breakpoint
ALTER TYPE "public"."signal_type" ADD VALUE 'renovation';--> statement-breakpoint
ALTER TYPE "public"."signal_type" ADD VALUE 'long_queue';--> statement-breakpoint
ALTER TYPE "public"."signal_type" ADD VALUE 'price_increase';--> statement-breakpoint
CREATE TABLE "review_analyses" (
	"place_id" text PRIMARY KEY NOT NULL,
	"reviews_hash" text NOT NULL,
	"model" text NOT NULL,
	"business_scale" "business_scale" NOT NULL,
	"summary_km" text NOT NULL,
	"analyzed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_analyses" ADD CONSTRAINT "review_analyses_place_id_places_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("place_id") ON DELETE no action ON UPDATE no action;