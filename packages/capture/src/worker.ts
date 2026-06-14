import { readFileSync } from "node:fs";
import { type NewLearning, createDb, learnings } from "@recall/shared";
import { isNotNull, sql } from "drizzle-orm";
import { dedupeWithinBatch } from "./dedup.js";
import { type LearningInput, buildExtractionPrompt, parseExtraction } from "./extract.js";
import { logEvent } from "./log.js";
import { embedPassage, extractLearnings } from "./nim.js";
import { nextSlice, readOffset, writeOffset } from "./offsets.js";
import { parseTranscript, projectFromCwd } from "./transcript.js";

const ENV_FILE = process.env.RECALL_ENV_FILE ?? "/Users/shekh/recall/.env";
const MIN_TURNS = 4;
const MIN_CHARS = 1500;
// Cosine similarity at or above this counts as a duplicate - both within one
// batch and against learnings already stored.
const DEDUP_THRESHOLD = Number(process.env.RECALL_DEDUP_THRESHOLD ?? 0.9);
// No human reviews captures, so the model's importance score (1-5) is the
// quality gate: only learnings rated this high or above are kept.
const KEEP_THRESHOLD = Number(process.env.RECALL_KEEP_THRESHOLD ?? 4);
// A fixed key every capture worker shares, so the dedup-check + insert below
// runs under one Postgres advisory lock and concurrent workers cannot both
// insert the same learning. The exact value is arbitrary; it only has to match.
const CAPTURE_LOCK_KEY = 461_982_017;

async function main(): Promise<void> {
  const started = Date.now();
  const [, , transcriptPath, sessionId = "", cwd = ""] = process.argv;

  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    // .env may be absent; the missing-var check below reports it.
  }
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!transcriptPath) {
    logEvent({ status: "error", sessionId, error: "missing_transcript_path" });
    return;
  }
  if (!databaseUrl || !apiKey) {
    logEvent({ status: "error", sessionId, error: "missing_env" });
    return;
  }

  let jsonl: string;
  try {
    jsonl = readFileSync(transcriptPath, "utf8");
  } catch (e) {
    logEvent({ status: "error", sessionId, error: `read_failed: ${(e as Error).message}` });
    return;
  }

  // Process only the transcript tail not yet seen for this session. A long
  // session fires PreCompact on every compaction; without this each fire would
  // re-extract the whole transcript. The offset advances only once a slice has
  // actually been run through extraction below, so a sub-gate tail accumulates
  // into the next run rather than being dropped.
  const { slice, totalLines } = nextSlice(jsonl, readOffset(sessionId));
  const turns = parseTranscript(slice);
  const totalChars = turns.reduce((n, t) => n + t.text.length, 0);
  if (turns.length < MIN_TURNS || totalChars < MIN_CHARS) {
    logEvent({ status: "skipped", sessionId, reason: "below_gate", turns: turns.length });
    return;
  }

  const project = projectFromCwd(cwd);
  const { db, close } = createDb(databaseUrl);
  try {
    const raw = await extractLearnings(apiKey, buildExtractionPrompt(turns));
    const candidates = parseExtraction(raw);
    if (candidates.length === 0) {
      // Extraction ran and found nothing - this slice is done.
      writeOffset(sessionId, totalLines);
      logEvent({ status: "empty", sessionId, project, turns: turns.length });
      return;
    }

    // Importance gate first, so we don't waste embed calls on low-value rows.
    const important = candidates.filter((c) => c.importance >= KEEP_THRESHOLD);
    if (important.length === 0) {
      writeOffset(sessionId, totalLines);
      logEvent({
        status: "empty",
        sessionId,
        project,
        reason: "below_importance",
        candidates: candidates.length,
      });
      return;
    }

    const embedded: { candidate: LearningInput; embedding: number[] }[] = [];
    for (const candidate of important) {
      const embedding = await embedPassage(apiKey, `${candidate.title}\n\n${candidate.body}`);
      embedded.push({ candidate, embedding });
    }

    // Drop near-duplicates within this batch first - pure, no DB needed.
    const unique = dedupeWithinBatch(embedded, DEDUP_THRESHOLD);

    // Serialise the cross-run dedup check and the insert behind a transaction
    // advisory lock. Without it, two workers running at once (e.g. a PreCompact
    // and the SessionEnd right after) could both query the nearest stored row,
    // both miss the other's not-yet-committed insert, and both store the same
    // learning. Under the lock the second worker waits for the first to commit,
    // then its dedup query sees the new rows. The lock is transaction-scoped, so
    // a crashed worker releases it on disconnect; captures are rare and the
    // section is tiny, so serialising globally costs nothing.
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CAPTURE_LOCK_KEY}::bigint)`);
      const fresh: typeof unique = [];
      for (const item of unique) {
        const vec = `[${item.embedding.join(",")}]`;
        const distance = sql<number>`${learnings.embedding} <=> ${vec}::vector`;
        const [near] = await tx
          .select({ distance })
          .from(learnings)
          .where(isNotNull(learnings.embedding))
          .orderBy(distance)
          .limit(1);
        const similarity = near ? 1 - Number(near.distance) : 0;
        if (similarity < DEDUP_THRESHOLD) fresh.push(item);
      }
      if (fresh.length === 0) return [] as NewLearning[];
      // Auto-kept: there is no human review step, so these are immediately
      // recallable. status='kept' is what search_learnings filters on.
      const newRows: NewLearning[] = fresh.map(({ candidate, embedding }) => ({
        kind: candidate.kind,
        project,
        title: candidate.title,
        body: candidate.body,
        why: candidate.why,
        howToApply: candidate.howToApply,
        tags: candidate.tags,
        importance: candidate.importance,
        embedding,
        status: "kept",
        sessionId,
      }));
      await tx.insert(learnings).values(newRows);
      return newRows;
    });

    if (rows.length === 0) {
      writeOffset(sessionId, totalLines);
      logEvent({
        status: "empty",
        sessionId,
        project,
        reason: "all_duplicates",
        candidates: candidates.length,
      });
      return;
    }

    writeOffset(sessionId, totalLines);
    logEvent({
      status: "ok",
      sessionId,
      project,
      inserted: rows.length,
      droppedLowImportance: candidates.length - important.length,
      deduped: important.length - rows.length,
      durationMs: Date.now() - started,
    });
  } catch (e) {
    logEvent({ status: "error", sessionId, project, error: (e as Error).message });
  } finally {
    await close();
  }
}

main().catch((e) => {
  logEvent({ status: "error", error: (e as Error).message });
});
