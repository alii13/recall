import { cards, type Database } from "@recall/shared";
import { eq } from "drizzle-orm";
import type { Context } from "hono";

export function makeGetCardHandler(db: Database) {
  return async (c: Context) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "missing_id" }, 400);

    const rows = await db.select().from(cards).where(eq(cards.id, id)).limit(1);
    const card = rows[0];
    if (!card) return c.json({ error: "not_found" }, 404);

    return c.json({
      ...card,
      embedding: card.embedding ? `<${card.embedding.length} dims>` : null,
    });
  };
}
