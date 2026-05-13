CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"title" text,
	"author" text,
	"published_at" timestamp with time zone,
	"source_type" text NOT NULL,
	"markdown" text,
	"summary" text,
	"why_useful" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"embedding" vector(1024),
	"note" text,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cards_url_hash_unique" UNIQUE("url_hash")
);
--> statement-breakpoint
CREATE INDEX "cards_embedding_idx" ON "cards" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "cards_created_at_idx" ON "cards" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cards_source_type_idx" ON "cards" USING btree ("source_type");