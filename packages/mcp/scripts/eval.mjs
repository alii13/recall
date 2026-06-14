// Retrieval eval for search_learnings. Because no human reads the learnings
// store, this is the only signal that recall actually works. Seeds known
// fixtures, runs real queries through the actual tool, reports precision, and
// cleans up. Run after `pnpm --filter @recall/mcp build`.
//
// Caveat: search_learnings has no session filter, so other `kept` rows in the
// store compete with the fixtures. Most meaningful against a small/clean store.
import { createDb, learnings } from "@recall/shared";
import { eq } from "drizzle-orm";
import { makeSearchLearningsTool } from "../dist/tools/learnings.js";

process.loadEnvFile("/Users/shekh/recall/.env");
const apiKey = process.env.NVIDIA_API_KEY;
const MARK = "eval-fixture";

async function embedPassage(text) {
  const res = await fetch("https://integrate.api.nvidia.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nvidia/nv-embedqa-e5-v5",
      input: text,
      input_type: "passage",
      encoding_format: "float",
    }),
  });
  if (!res.ok) throw new Error(`embed_${res.status}`);
  return (await res.json()).data[0].embedding;
}

const FIXTURES = [
  {
    kind: "decision",
    title: "use-drizzle-kit-for-migrations",
    body: "Manage Postgres schema with drizzle-kit generate/migrate; never hand-write SQL migrations.",
    tags: ["db", "drizzle", "migrations"],
  },
  {
    kind: "correction",
    title: "never-force-push-shared-branches",
    body: "Do not force-push to main or any shared branch; it rewrites history others depend on.",
    tags: ["git", "force-push"],
  },
  {
    kind: "gotcha",
    title: "cloudflare-pages-needs-index-in-folder",
    body: "Cloudflare Pages only serves /path when the file is at /path/index.html, not /path.html.",
    tags: ["cloudflare", "routing"],
  },
  {
    kind: "decision",
    title: "use-pgvector-hnsw-cosine",
    body: "Use pgvector with an HNSW index and cosine ops for semantic search over embeddings.",
    tags: ["pgvector", "search"],
  },
  {
    kind: "gotcha",
    title: "neon-free-tier-suspends-when-idle",
    body: "Neon free tier auto-suspends after about 5 minutes idle; the first query then wakes it with ~1s latency.",
    tags: ["neon", "postgres"],
  },
  {
    kind: "correction",
    title: "stage-git-files-by-name",
    body: "Stage files explicitly by name in git; never use git add -A or git add dot.",
    tags: ["git"],
  },
];

const QUERIES = [
  { q: "how do I change the database schema safely?", expect: "use-drizzle-kit-for-migrations" },
  { q: "is it ok to force push to main?", expect: "never-force-push-shared-branches" },
  {
    q: "why won't my /rules page load on cloudflare pages?",
    expect: "cloudflare-pages-needs-index-in-folder",
  },
  { q: "what should I use for vector similarity search?", expect: "use-pgvector-hnsw-cosine" },
  {
    q: "the database is really slow on the first request after a while",
    expect: "neon-free-tier-suspends-when-idle",
  },
  { q: "how should I add files to a git commit?", expect: "stage-git-files-by-name" },
];

const { db, close } = createDb(process.env.DATABASE_URL);
try {
  for (const f of FIXTURES) {
    const embedding = await embedPassage(f.body);
    await db
      .insert(learnings)
      .values({ ...f, embedding, status: "kept", importance: 5, sessionId: MARK });
  }

  const tool = makeSearchLearningsTool({ db, nvidiaApiKey: apiKey });
  let hit1 = 0;
  let hit3 = 0;
  const misses = [];
  for (const { q, expect } of QUERIES) {
    const res = await tool({ query: q, limit: 3 });
    const titles = JSON.parse(res.content[0].text).map((r) => r.title);
    if (titles[0] === expect) hit1++;
    if (titles.slice(0, 3).includes(expect)) hit3++;
    else misses.push({ q, expect, got: titles });
  }

  const n = QUERIES.length;
  console.log(
    JSON.stringify(
      {
        n,
        "precision@1": Number((hit1 / n).toFixed(2)),
        "recall@3": Number((hit3 / n).toFixed(2)),
        misses,
      },
      null,
      2,
    ),
  );
} finally {
  await db.delete(learnings).where(eq(learnings.sessionId, MARK));
  await close();
}
