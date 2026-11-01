--> One snapshot per place per calendar day, so a retried enrich job overwrites
--> its own row. Added nullable and backfilled first: ADD COLUMN ... NOT NULL
--> without a default fails on a table that already has rows.
ALTER TABLE "snapshots" ADD COLUMN "scan_date" date;--> statement-breakpoint
UPDATE "snapshots" SET "scan_date" = ("scanned_at" AT TIME ZONE 'Asia/Phnom_Penh')::date WHERE "scan_date" IS NULL;--> statement-breakpoint
--> Existing same-day duplicates are the artefacts this index prevents; keep the
--> most recent of each and drop the rest, or the index cannot be created.
DELETE FROM "snapshots" s USING "snapshots" t WHERE s."place_id" = t."place_id" AND s."scan_date" = t."scan_date" AND (s."scanned_at" < t."scanned_at" OR (s."scanned_at" = t."scanned_at" AND s.ctid < t.ctid));--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "scan_date" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_place_day_uniq" ON "snapshots" USING btree ("place_id","scan_date");
