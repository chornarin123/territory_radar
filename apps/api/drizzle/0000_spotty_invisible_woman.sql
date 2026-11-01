CREATE TYPE "public"."lead_status" AS ENUM('new', 'visited', 'won', 'declined', 'revisit');--> statement-breakpoint
CREATE TYPE "public"."place_status" AS ENUM('active', 'missing', 'closed');--> statement-breakpoint
CREATE TYPE "public"."signal_type" AS ENUM('new_opening', 'velocity_spike', 'low_stock', 'hours_extended');--> statement-breakpoint
CREATE TABLE "areas" (
	"sangkat_code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_km" text NOT NULL,
	"district_code" text NOT NULL,
	"province_code" text NOT NULL,
	"households" integer,
	"population" integer,
	"ppi_score" double precision,
	"ppi_components" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grid_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sangkat_code" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_m" integer NOT NULL,
	"saturated" boolean DEFAULT false NOT NULL,
	"parent_cell_id" uuid,
	"last_scanned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"api_calls" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" text NOT NULL,
	"officer_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"outcome_note" text,
	"revisit_after" date
);
--> statement-breakpoint
CREATE TABLE "officers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"branch" text NOT NULL,
	"assigned_sangkats" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"place_id" text PRIMARY KEY NOT NULL,
	"sangkat_code" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"primary_type" text,
	"is_multi_branch" boolean DEFAULT false NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"status" "place_status" DEFAULT 'active' NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"place_id" text NOT NULL,
	"scan_date" date NOT NULL,
	"need" real NOT NULL,
	"capacity" real NOT NULL,
	"bankability" real NOT NULL,
	"total" real NOT NULL,
	"top_factors" jsonb NOT NULL,
	CONSTRAINT "scores_place_id_scan_date_pk" PRIMARY KEY("place_id","scan_date")
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"signal_type" "signal_type" NOT NULL,
	"evidence" text NOT NULL,
	"confidence" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" text NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"review_count" integer,
	"rating" real,
	"price_level" smallint,
	"open_hours" jsonb,
	"has_web_or_page" boolean
);
--> statement-breakpoint
ALTER TABLE "grid_cells" ADD CONSTRAINT "grid_cells_sangkat_code_areas_sangkat_code_fk" FOREIGN KEY ("sangkat_code") REFERENCES "public"."areas"("sangkat_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_cells" ADD CONSTRAINT "grid_cells_parent_cell_id_grid_cells_id_fk" FOREIGN KEY ("parent_cell_id") REFERENCES "public"."grid_cells"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_place_id_places_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("place_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_officer_id_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_sangkat_code_areas_sangkat_code_fk" FOREIGN KEY ("sangkat_code") REFERENCES "public"."areas"("sangkat_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_place_id_places_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("place_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_place_id_places_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("place_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_place_id_places_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("place_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_district_idx" ON "areas" USING btree ("district_code");--> statement-breakpoint
CREATE INDEX "grid_cells_sangkat_idx" ON "grid_cells" USING btree ("sangkat_code");--> statement-breakpoint
CREATE INDEX "grid_cells_parent_idx" ON "grid_cells" USING btree ("parent_cell_id");--> statement-breakpoint
CREATE INDEX "job_runs_name_started_idx" ON "job_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE INDEX "leads_officer_status_idx" ON "leads" USING btree ("officer_id","status");--> statement-breakpoint
CREATE INDEX "leads_place_idx" ON "leads" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "places_sangkat_status_idx" ON "places" USING btree ("sangkat_code","status");--> statement-breakpoint
CREATE INDEX "places_last_seen_idx" ON "places" USING btree ("last_seen");--> statement-breakpoint
CREATE INDEX "scores_date_total_idx" ON "scores" USING btree ("scan_date","total");--> statement-breakpoint
CREATE INDEX "signals_place_type_detected_idx" ON "signals" USING btree ("place_id","signal_type","detected_at");--> statement-breakpoint
CREATE INDEX "snapshots_place_scanned_idx" ON "snapshots" USING btree ("place_id","scanned_at");