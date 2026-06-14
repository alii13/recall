import { fileURLToPath } from "node:url";
import { createDb, learnings } from "@recall/shared";
import { eq, inArray } from "drizzle-orm";
import { cosineSimilarity } from "./dedup.js";
import { logEvent } from "./log.js";

const ENV_FILE = process.env.RECALL_ENV_FILE ?? "/Users/shekh/recall/.env";
const DEDUP_THRESHOLD = Number(process.env.RECALL_SWEEP_DEDUP_THRESHOLD ?? 0.93);
const STALE_DAYS = Number(process.env.RECALL_SWEEP_STALE_DAYS ?? 120);
// Hard cap on deletions per run - bounds the blast radius of a bad call.
const MAX_DELETE_PER_RUN = Number(process.env.RECALL_SWEEP_MAX_DELETE ?? 25);

export type SweepRow = {
  id: string;
  title: string;
  importance: number;
  surfaceCount: number;
  createdAt: Date;
  embedding: number[];
};

export type SweepAction = { id: string; title: string; reason: "duplicate" | "stale" };

// Decide which kept learnings to prune: near-duplicates that slipped past
// capture-time dedup, and stale rows (never surfaced, old, lowest kept tier).
// Pure and deterministic so it is unit-testable and the cron is predictable.
// Never prunes importance-5 rows - those were rated load-bearing.
export function planSweep(
  rows: SweepRow[],
  opts: { dedupThreshold: number; staleCutoff: Date; maxDelete: number },
): SweepAction[] {
  const doomed = new Map<string, "duplicate" | "stale">();

  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (!a || doomed.has(a.id)) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j];
      if (!b || doomed.has(b.id)) continue;
      if (cosineSimilarity(a.embedding, b.embedding) >= opts.dedupThreshold) {
        const loser = weaker(a, b);
        doomed.set(loser.id, "duplicate");
        if (loser.id === a.id) break;
      }
    }
  }

  for (const r of rows) {
    if (doomed.has(r.id)) continue;
    if (r.importance <= 4 && r.surfaceCount === 0 && r.createdAt < opts.staleCutoff) {
      doomed.set(r.id, "stale");
    }
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  return [...doomed.entries()]
    .slice(0, opts.maxDelete)
    .map(([id, reason]) => ({ id, title: byId.get(id)?.title ?? "", reason }));
}

// The weaker of a duplicate pair (deleted first): lower importance, then less
// surfaced, then older.
function weaker(a: SweepRow, b: SweepRow): SweepRow {
  if (a.importance !== b.importance) return a.importance < b.importance ? a : b;
  if (a.surfaceCount !== b.surfaceCount) return a.surfaceCount < b.surfaceCount ? a : b;
  return a.createdAt <= b.createdAt ? a : b;
}

function toVec(e: unknown): number[] {
  if (Array.isArray(e)) return e as number[];
  if (typeof e === "string") return JSON.parse(e) as number[];
  return [];
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    // env may already be present
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    logEvent({ status: "sweep_error", error: "missing_env" });
    return;
  }

  const { db, close } = createDb(url);
  try {
    const raw = await db
      .select({
        id: learnings.id,
        title: learnings.title,
        importance: learnings.importance,
        surfaceCount: learnings.surfaceCount,
        createdAt: learnings.createdAt,
        embedding: learnings.embedding,
      })
      .from(learnings)
      .where(eq(learnings.status, "kept"));

    const rows: SweepRow[] = raw
      .filter((r) => r.embedding != null)
      .map((r) => ({
        id: r.id,
        title: r.title,
        importance: r.importance,
        surfaceCount: r.surfaceCount,
        createdAt: r.createdAt,
        embedding: toVec(r.embedding),
      }));

    const staleCutoff = new Date(Date.now() - STALE_DAYS * 86_400_000);
    const plan = planSweep(rows, {
      dedupThreshold: DEDUP_THRESHOLD,
      staleCutoff,
      maxDelete: MAX_DELETE_PER_RUN,
    });

    if (plan.length === 0) {
      logEvent({ status: "sweep", kept: rows.length, deleted: 0 });
      return;
    }

    await db.delete(learnings).where(
      inArray(
        learnings.id,
        plan.map((p) => p.id),
      ),
    );
    // Full audit trail: every removed row with its reason.
    logEvent({
      status: "sweep",
      kept: rows.length - plan.length,
      deleted: plan.length,
      capHit: plan.length >= MAX_DELETE_PER_RUN,
      removed: plan,
    });
  } catch (e) {
    logEvent({ status: "sweep_error", error: (e as Error).message });
  } finally {
    await close();
  }
}

// Only run when invoked directly (cron), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
