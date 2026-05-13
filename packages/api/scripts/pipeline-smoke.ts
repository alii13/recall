import { createDb, cards, normalizeUrl, urlHash } from "@recall/shared";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { processCard } from "../src/pipeline/process.js";

const env = Object.fromEntries(
  readFileSync("/Users/shekh/recall/.env", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const eq = l.indexOf("=");
      return [l.slice(0, eq), l.slice(eq + 1)];
    }),
) as Record<string, string>;

const url = process.argv[2] ?? "https://en.wikipedia.org/wiki/Retrieval-augmented_generation";
const normalized = normalizeUrl(url);
const hash = urlHash(normalized);

const { db, close } = createDb(env.DATABASE_URL!);

try {
  const existing = await db.select().from(cards).where(eq(cards.urlHash, hash)).limit(1);
  let id: string;
  if (existing[0]) {
    console.log(`Reusing existing card: ${existing[0].id}`);
    id = existing[0].id;
    await db
      .update(cards)
      .set({
        extractionStatus: "pending",
        errorMessage: null,
        embedding: null,
        summary: null,
        whyUseful: null,
      })
      .where(eq(cards.id, id));
  } else {
    const [inserted] = await db
      .insert(cards)
      .values({
        url: normalized,
        urlHash: hash,
        sourceType: "unknown",
        extractionStatus: "pending",
      })
      .returning({ id: cards.id });
    if (!inserted) throw new Error("insert returned no row");
    id = inserted.id;
    console.log(`Inserted card: ${id}`);
  }

  console.log("Processing...");
  const start = Date.now();
  await processCard(id, {
    db,
    nvidiaApiKey: env.NVIDIA_API_KEY!,
    jinaApiKey: env.JINA_API_KEY,
  });
  console.log(`Processed in ${Date.now() - start}ms`);

  const [final] = await db.select().from(cards).where(eq(cards.id, id)).limit(1);
  if (!final) throw new Error("card disappeared");

  console.log("\n=== final state ===");
  console.log(`id: ${final.id}`);
  console.log(`url: ${final.url}`);
  console.log(`source_type: ${final.sourceType}`);
  console.log(`status: ${final.extractionStatus}`);
  console.log(`title: ${final.title}`);
  console.log(`author: ${final.author ?? "(none)"}`);
  console.log(`tags: ${JSON.stringify(final.tags)}`);
  console.log(`summary: ${final.summary}`);
  console.log(`why_useful: ${final.whyUseful}`);
  console.log(`markdown length: ${final.markdown?.length ?? 0}`);
  console.log(`embedding present: ${final.embedding ? `yes (${final.embedding.length} dims)` : "no"}`);
  console.log(`error: ${final.errorMessage ?? "(none)"}`);
} finally {
  await close();
}
