import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    urlHash: text("url_hash").notNull().unique(),
    title: text("title"),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    sourceType: text("source_type").notNull(),
    markdown: text("markdown"),
    summary: text("summary"),
    whyUseful: text("why_useful"),
    tags: text("tags").array().notNull().default([]),
    embedding: vector("embedding", { dimensions: 1024 }),
    note: text("note"),
    extractionStatus: text("extraction_status").notNull().default("pending"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
  },
  (t) => [
    index("cards_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("cards_created_at_idx").on(t.createdAt.desc()),
    index("cards_source_type_idx").on(t.sourceType),
  ],
);

export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
