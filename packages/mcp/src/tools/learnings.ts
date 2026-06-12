import { type Database, learnings } from "@recall/shared";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { embedQuery } from "../embed.js";

export const searchLearningsInputSchema = {
  query: z
    .string()
    .describe(
      "Natural language description of what you're working on or recalling. Searches the user's reviewed learnings from past sessions - decisions made, corrections given, and gotchas discovered.",
    ),
  project: z
    .string()
    .optional()
    .describe("Filter to one project slug (e.g. 'recall', 'atlan-frontend', 'uno-no-mercy')"),
  kind: z.enum(["decision", "correction", "gotcha"]).optional().describe("Filter by learning kind"),
  limit: z.number().int().min(1).max(20).optional().describe("Max results (default 5, max 20)"),
};

export type SearchLearningsOpts = {
  db: Database;
  nvidiaApiKey: string;
};

export function makeSearchLearningsTool(opts: SearchLearningsOpts) {
  return async (input: {
    query: string;
    project?: string;
    kind?: "decision" | "correction" | "gotcha";
    limit?: number;
  }) => {
    const limit = input.limit ?? 5;
    const vec = await embedQuery(opts.nvidiaApiKey, input.query);
    const vecLiteral = `[${vec.join(",")}]`;
    const distance = sql<number>`${learnings.embedding} <=> ${vecLiteral}::vector`;

    // Only kept (reviewed) learnings are recallable - pending captures stay hidden.
    const filters = [eq(learnings.status, "kept"), isNotNull(learnings.embedding)];
    if (input.project) filters.push(eq(learnings.project, input.project));
    if (input.kind) filters.push(eq(learnings.kind, input.kind));

    const rows = await opts.db
      .select({
        id: learnings.id,
        kind: learnings.kind,
        project: learnings.project,
        title: learnings.title,
        body: learnings.body,
        why: learnings.why,
        howToApply: learnings.howToApply,
        tags: learnings.tags,
        createdAt: learnings.createdAt,
        distance,
      })
      .from(learnings)
      .where(and(...filters))
      .orderBy(distance)
      .limit(limit);

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await opts.db
        .update(learnings)
        .set({ lastSurfacedAt: new Date(), surfaceCount: sql`${learnings.surfaceCount} + 1` })
        .where(inArray(learnings.id, ids));
    }

    const results = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      project: r.project,
      title: r.title,
      body: r.body,
      why: r.why,
      how_to_apply: r.howToApply,
      tags: r.tags,
      created_at: r.createdAt,
      score: Number((1 - r.distance).toFixed(4)),
    }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
  };
}
