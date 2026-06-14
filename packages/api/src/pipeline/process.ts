import { type Database, cards, providedContent, routeUrl } from "@recall/shared";
import { eq } from "drizzle-orm";
import { extract } from "../extractors/index.js";
import { embed } from "./embed.js";
import { summarize } from "./summarize.js";

export type ProcessOpts = {
  db: Database;
  nvidiaApiKey: string;
  jinaApiKey?: string;
};

export type ProcessInput = {
  providedText?: string;
};

export async function processCard(
  cardId: string,
  opts: ProcessOpts,
  input: ProcessInput = {},
): Promise<void> {
  const { db, nvidiaApiKey, jinaApiKey } = opts;
  const rows = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  const card = rows[0];
  if (!card) return;

  const provided = input.providedText?.trim();

  let extracted;
  if (provided) {
    extracted = { ...providedContent(provided), sourceType: routeUrl(card.url) };
  } else {
    try {
      extracted = await extract(card.url, { jinaApiKey });
    } catch (e) {
      await db
        .update(cards)
        .set({
          extractionStatus: "failed",
          errorMessage: `extract: ${(e as Error).message}`,
        })
        .where(eq(cards.id, cardId));
      return;
    }
  }

  const baseUpdate = {
    title: extracted.title,
    author: extracted.author,
    publishedAt: extracted.publishedAt,
    markdown: extracted.markdown,
    sourceType: extracted.sourceType,
  };

  if (!extracted.markdown) {
    await db
      .update(cards)
      .set({
        ...baseUpdate,
        extractionStatus: "failed",
        errorMessage: "no_content_extracted",
      })
      .where(eq(cards.id, cardId));
    return;
  }

  let summary;
  try {
    summary = await summarize(nvidiaApiKey, {
      title: extracted.title,
      url: card.url,
      sourceType: extracted.sourceType,
      markdown: extracted.markdown,
    });
  } catch (e) {
    await db
      .update(cards)
      .set({
        ...baseUpdate,
        extractionStatus: "degraded",
        errorMessage: `summary: ${(e as Error).message}`,
      })
      .where(eq(cards.id, cardId));
    return;
  }

  const embedInput = `${extracted.title ?? ""}\n\n${summary.summary}\n\nTags: ${summary.tags.join(", ")}`;
  let embedding;
  try {
    embedding = await embed(nvidiaApiKey, embedInput, "passage");
  } catch (e) {
    await db
      .update(cards)
      .set({
        ...baseUpdate,
        summary: summary.summary,
        whyUseful: summary.whyUseful,
        tags: summary.tags,
        extractionStatus: "degraded",
        errorMessage: `embed: ${(e as Error).message}`,
      })
      .where(eq(cards.id, cardId));
    return;
  }

  await db
    .update(cards)
    .set({
      ...baseUpdate,
      summary: summary.summary,
      whyUseful: summary.whyUseful,
      tags: summary.tags,
      embedding,
      extractionStatus: extracted.status === "degraded" ? "degraded" : "ok",
      errorMessage: null,
    })
    .where(eq(cards.id, cardId));
}
