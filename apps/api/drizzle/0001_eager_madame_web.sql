ALTER TABLE "leads" ADD COLUMN "route_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "route_position" integer;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "name_hash" text;--> statement-breakpoint
CREATE INDEX "leads_route_idx" ON "leads" USING btree ("route_id","route_position");--> statement-breakpoint
CREATE INDEX "places_name_hash_idx" ON "places" USING btree ("name_hash");