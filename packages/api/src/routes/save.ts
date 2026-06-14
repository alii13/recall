import { cards, type Database, normalizeUrl, urlHash } from "@recall/shared";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { processCard } from "../pipeline/process.js";

const bodySchema = z.object({
  url: z.string().min(1),
  note: z.string().optional(),
  text: z.string().optional(),
});

export type SaveCtx = {
  db: Database;
  nvidiaApiKey: string;
  jinaApiKey?: string;
};

export function makeSaveHandler(ctx: SaveCtx) {
  return async (c: Context) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
    }

    let normalized: string;
    try {
      normalized = normalizeUrl(parsed.data.url);
    } catch {
      return c.json({ error: "invalid_url" }, 400);
    }
    const hash = urlHash(normalized);

    const existing = await ctx.db
      .select({ id: cards.id })
      .from(cards)
      .where(eq(cards.urlHash, hash))
      .limit(1);
    if (existing[0]) {
      return c.json({ card_id: existing[0].id, deduped: true });
    }

    const [inserted] = await ctx.db
      .insert(cards)
      .values({
        url: normalized,
        urlHash: hash,
        sourceType: "unknown",
        extractionStatus: "pending",
        note: parsed.data.note ?? null,
      })
      .returning({ id: cards.id });
    if (!inserted) {
      return c.json({ error: "insert_failed" }, 500);
    }

    const providedText = parsed.data.text;
    setImmediate(() => {
      processCard(inserted.id, ctx, { providedText }).catch((e) => {
        console.error(`[processCard ${inserted.id}] ${(e as Error).message}`);
      });
    });

    return c.json({ card_id: inserted.id, deduped: false });
  };
}
