import { readFileSync } from "node:fs";
import { type NewLearning, createDb, learnings } from "@recall/shared";
import { buildExtractionPrompt, parseExtraction } from "./extract.js";
import { logEvent } from "./log.js";
import { embedPassage, extractLearnings } from "./nim.js";
import { parseTranscript, projectFromCwd } from "./transcript.js";

const ENV_FILE = process.env.RECALL_ENV_FILE ?? "/Users/shekh/recall/.env";
const MIN_TURNS = 4;
const MIN_CHARS = 1500;

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

  const turns = parseTranscript(jsonl);
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
      logEvent({ status: "empty", sessionId, project, turns: turns.length });
      return;
    }

    const rows: NewLearning[] = [];
    for (const c of candidates) {
      const embedding = await embedPassage(apiKey, `${c.title}\n\n${c.body}`);
      rows.push({
        kind: c.kind,
        project,
        title: c.title,
        body: c.body,
        why: c.why,
        howToApply: c.howToApply,
        tags: c.tags,
        embedding,
        sessionId,
      });
    }
    await db.insert(learnings).values(rows);
    logEvent({
      status: "ok",
      sessionId,
      project,
      inserted: rows.length,
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
