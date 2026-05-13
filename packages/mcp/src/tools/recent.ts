import { type Database, cards } from "@recall/shared";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

export const recentInputSchema = {
  days: z.number().int().positive().optional().describe("Look back N days (default 7)"),
  source_type: z
    .string()
    .optional()
    .describe("Filter by source: reddit | youtube | twitter | github | hackernews | article"),
  limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10, max 50)"),
};

export function makeRecentTool(db: Database) {
  return async (input: { days?: number; source_type?: string; limit?: number }) => {
    const days = input.days ?? 7;
    const limit = input.limit ?? 10;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const filters = [
      inArray(cards.extractionStatus, ["ok", "degraded"]),
      gte(cards.createdAt, cutoff),
    ];
    if (input.source_type) {
      filters.push(eq(cards.sourceType, input.source_type));
    }

    const rows = await db
      .select({
        id: cards.id,
        url: cards.url,
        title: cards.title,
        summary: cards.summary,
        whyUseful: cards.whyUseful,
        sourceType: cards.sourceType,
        tags: cards.tags,
        createdAt: cards.createdAt,
      })
      .from(cards)
      .where(and(...filters))
      .orderBy(desc(cards.createdAt))
      .limit(limit);

    const results = rows.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      summary: r.summary,
      why_useful: r.whyUseful,
      source_type: r.sourceType,
      tags: r.tags,
      saved_at: r.createdAt,
    }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
  };
}
