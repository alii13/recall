import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Per-session capture progress. The transcript JSONL is append-only across a
// session (compaction summarises the model's context window, not the on-disk
// file), so "how many lines we have already extracted from" is enough to
// process only the new tail on each run. Without this, every PreCompact fire
// re-extracts the whole transcript - dedup throws the overlap away, but the
// NIM + embed calls still run. State lives outside the repo, next to the log;
// override the directory with RECALL_OFFSET_DIR.
function offsetDir(): string {
  return process.env.RECALL_OFFSET_DIR ?? `${process.env.HOME ?? "/tmp"}/.recall/offsets`;
}

// Session ids are uuids in practice; sanitise anyway so a hostile id can never
// escape the offset directory.
function offsetPath(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(offsetDir(), safe);
}

export function readOffset(sessionId: string): number {
  if (!sessionId) return 0;
  try {
    const n = Number.parseInt(readFileSync(offsetPath(sessionId), "utf8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeOffset(sessionId: string, lines: number): void {
  if (!sessionId) return;
  try {
    const path = offsetPath(sessionId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(lines));
  } catch {
    // Best-effort: a failed write just means the next run reprocesses from the
    // old offset, and the cross-run dedup still prevents duplicate inserts.
  }
}

// Return the transcript lines not yet processed plus the new total line count to
// persist. A trailing newline produces a phantom empty element on split; drop it
// so the count stays stable and a later run never skips the last real line. An
// offset past the end (should not happen with an append-only file) clamps to an
// empty slice rather than throwing.
export function nextSlice(jsonl: string, offset: number): { slice: string; totalLines: number } {
  const lines = jsonl.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const total = lines.length;
  const start = Math.max(0, Math.min(offset, total));
  return { slice: lines.slice(start).join("\n"), totalLines: total };
}
