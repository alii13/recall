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

export const learnings = pgTable(
  "learnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    project: text("project"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    why: text("why"),
    howToApply: text("how_to_apply"),
    tags: text("tags").array().notNull().default([]),
    embedding: vector("embedding", { dimensions: 1024 }),
    origin: text("origin").notNull().default("session-capture"),
    sessionId: text("session_id"),
    supersededBy: uuid("superseded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSurfacedAt: timestamp("last_surfaced_at", { withTimezone: true }),
    surfaceCount: integer("surface_count").notNull().default(0),
  },
  (t) => [
    index("learnings_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("learnings_project_idx").on(t.project),
    index("learnings_created_at_idx").on(t.createdAt.desc()),
  ],
);

export type Learning = typeof learnings.$inferSelect;
export type NewLearning = typeof learnings.$inferInsert;
