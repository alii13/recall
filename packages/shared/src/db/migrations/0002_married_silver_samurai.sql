ALTER TABLE "learnings" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
CREATE INDEX "learnings_status_idx" ON "learnings" USING btree ("status");