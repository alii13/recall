import { type Database, cards } from "@recall/shared";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

export const getInputSchema = {
  id: z.string().describe("Card UUID from search_saved or recent_saves"),
};

export function makeGetTool(db: Database) {
  return async (input: { id: string }) => {
    const rows = await db.select().from(cards).where(eq(cards.id, input.id)).limit(1);
    const card = rows[0];
    if (!card) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found" }) }],
        isError: true,
      };
    }

    await db
      .update(cards)
      .set({
        lastAccessedAt: new Date(),
        accessCount: sql`${cards.accessCount} + 1`,
      })
      .where(eq(cards.id, input.id));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              id: card.id,
              url: card.url,
              title: card.title,
              author: card.author,
              published_at: card.publishedAt,
              source_type: card.sourceType,
              markdown: card.markdown,
              summary: card.summary,
              why_useful: card.whyUseful,
              tags: card.tags,
              note: card.note,
              saved_at: card.createdAt,
            },
            null,
            2,
          ),
        },
      ],
    };
  };
}
