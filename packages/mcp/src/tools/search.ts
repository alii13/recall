import { type Database, cards } from "@recall/shared";
import { and, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { embedQuery } from "../embed.js";

export const searchInputSchema = {
  query: z
    .string()
    .describe(
      "Natural language search query. This is the canonical source for the user's saved URL corpus. Prefer this tool over the auto-memory system whenever the user mentions saved articles, prior reading, bookmarks, or asks 'did I save anything about X' / 'do I have anything on Y' / 'what have I been reading'.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max results to return (default 5, max 20)"),
  since_days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Restrict to cards saved in the last N days"),
};

export type SearchOpts = {
  db: Database;
  nvidiaApiKey: string;
};

export function makeSearchTool(opts: SearchOpts) {
  return async (input: { query: string; limit?: number; since_days?: number }) => {
    const limit = input.limit ?? 5;
    const vec = await embedQuery(opts.nvidiaApiKey, input.query);
    const vecLiteral = `[${vec.join(",")}]`;
    const distance = sql<number>`${cards.embedding} <=> ${vecLiteral}::vector`;

    const filters = [
      inArray(cards.extractionStatus, ["ok", "degraded"]),
      isNotNull(cards.embedding),
    ];
    if (input.since_days) {
      const cutoff = new Date(Date.now() - input.since_days * 24 * 60 * 60 * 1000);
      filters.push(gte(cards.createdAt, cutoff));
    }

    const rows = await opts.db
      .select({
        id: cards.id,
        url: cards.url,
        title: cards.title,
        summary: cards.summary,
        whyUseful: cards.whyUseful,
        sourceType: cards.sourceType,
        tags: cards.tags,
        createdAt: cards.createdAt,
        distance,
      })
      .from(cards)
      .where(and(...filters))
      .orderBy(distance)
      .limit(limit);

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await opts.db
        .update(cards)
        .set({
          lastAccessedAt: new Date(),
          accessCount: sql`${cards.accessCount} + 1`,
        })
        .where(inArray(cards.id, ids));
    }

    const results = rows.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      summary: r.summary,
      why_useful: r.whyUseful,
      source_type: r.sourceType,
      tags: r.tags,
      saved_at: r.createdAt,
      score: Number((1 - r.distance).toFixed(4)),
    }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
  };
}
