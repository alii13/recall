import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// One JSONL line per event. Both the launcher and the worker write here so a
// detached, stdio-less worker still leaves a trail. Default lives outside the
// repo so it never gets committed; override with RECALL_CAPTURE_LOG.
const LOG_PATH =
  process.env.RECALL_CAPTURE_LOG ?? `${process.env.HOME ?? "/tmp"}/.recall/capture.log`;

export function logEvent(event: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`;
    appendFileSync(LOG_PATH, line);
  } catch {
    // Logging must never throw into the hook or worker.
  }
}
