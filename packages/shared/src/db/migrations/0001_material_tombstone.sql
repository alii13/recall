CREATE TABLE "learnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"project" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"why" text,
	"how_to_apply" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"embedding" vector(1024),
	"origin" text DEFAULT 'session-capture' NOT NULL,
	"session_id" text,
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_surfaced_at" timestamp with time zone,
	"surface_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "learnings_embedding_idx" ON "learnings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "learnings_project_idx" ON "learnings" USING btree ("project");--> statement-breakpoint
CREATE INDEX "learnings_created_at_idx" ON "learnings" USING btree ("created_at" DESC NULLS LAST);