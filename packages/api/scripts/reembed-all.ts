import { cards, createDb } from "@recall/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { readFileSync } from "node:fs";

const EXPECTED_DIM = 1024;
const DEFAULT_MODEL = "nvidia/nv-embedqa-e5-v5";
const ENDPOINT = "https://integrate.api.nvidia.com/v1/embeddings";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const model =
  args.find((a) => a.startsWith("--model="))?.slice("--model=".length) ?? DEFAULT_MODEL;
const limitArg = args.find((a) => a.startsWith("--limit="))?.slice("--limit=".length);
const limit = limitArg ? Number.parseInt(limitArg, 10) : Number.POSITIVE_INFINITY;

const env = Object.fromEntries(
  readFileSync("/Users/shekh/recall/.env", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const eq = l.indexOf("=");
      return [l.slice(0, eq), l.slice(eq + 1)];
    }),
) as Record<string, string>;

if (!env.DATABASE_URL || !env.NVIDIA_API_KEY) {
  console.error("error: DATABASE_URL and NVIDIA_API_KEY required in /Users/shekh/recall/.env");
  process.exit(1);
}

const { db, close } = createDb(env.DATABASE_URL);

async function embedOne(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: text,
      input_type: "passage",
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`http_${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = data.data?.[0]?.embedding;
  if (!vec) throw new Error("no embedding in response");
  return vec;
}

try {
  console.log(`reembed using model: ${model}${dryRun ? " (DRY RUN)" : ""}`);

  const rows = await db
    .select({
      id: cards.id,
      title: cards.title,
      summary: cards.summary,
      tags: cards.tags,
    })
    .from(cards)
    .where(
      and(
        inArray(cards.extractionStatus, ["ok", "degraded"]),
        isNotNull(cards.summary),
      ),
    );

  const targets = rows.slice(0, limit);
  console.log(`${rows.length} eligible cards (processing ${targets.length})`);
  console.log();

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  let dimChecked = false;

  for (const card of targets) {
    const title = (card.title ?? "untitled").slice(0, 60);
    const input = [card.title ?? "", "", card.summary, "", `Tags: ${card.tags.join(", ")}`].join(
      "\n",
    );

    if (dryRun) {
      console.log(`  dry: ${card.id}  ${title}`);
      skipped++;
      continue;
    }

    try {
      const vec = await embedOne(input, env.NVIDIA_API_KEY);

      if (!dimChecked) {
        if (vec.length !== EXPECTED_DIM) {
          console.error(`\nerror: model "${model}" returns ${vec.length} dims but schema expects ${EXPECTED_DIM}.`);
          console.error(`The cards.embedding column is vector(${EXPECTED_DIM}). To switch models with a different dim:`);
          console.error(`  1. ALTER TABLE cards DROP COLUMN embedding;`);
          console.error(`  2. ALTER TABLE cards ADD COLUMN embedding vector(${vec.length});`);
          console.error(`  3. DROP INDEX IF EXISTS cards_embedding_idx;`);
          console.error(`  4. CREATE INDEX cards_embedding_idx ON cards USING hnsw (embedding vector_cosine_ops);`);
          console.error(`  5. Update packages/shared/src/db/schema.ts dimensions to ${vec.length} and rerun pnpm db:generate.`);
          console.error(`  6. Rerun this script.`);
          process.exit(2);
        }
        dimChecked = true;
      }

      await db.update(cards).set({ embedding: vec }).where(eq(cards.id, card.id));
      ok++;
      console.log(`  ok : ${card.id}  ${title}`);
    } catch (e) {
      fail++;
      console.log(`  err: ${card.id}  ${title}  -  ${(e as Error).message}`);
    }
  }

  console.log(`\ndone: ${ok} reembedded, ${fail} failed, ${skipped} skipped (dry-run)`);
  process.exit(fail > 0 ? 1 : 0);
} finally {
  await close();
}
