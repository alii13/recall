import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logEvent } from "./log.js";

// SessionEnd and PreCompact hooks have a tight timeout and cannot block. So this
// stays a thin launcher: read the event JSON from stdin, spawn a detached worker
// that does the slow NIM + embed + insert work with no timeout pressure, and exit
// fast. The same launcher serves both events - the worker only needs the
// transcript path, session id, and cwd, which both event payloads provide.
type HookInput = { transcript_path?: string; session_id?: string; cwd?: string };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  let payload: HookInput = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}") as HookInput;
  } catch {
    // Malformed stdin: fall through to the no-transcript path.
  }

  const transcriptPath = payload.transcript_path;
  const sessionId = payload.session_id ?? "";
  const cwd = payload.cwd ?? "";

  if (!transcriptPath) {
    logEvent({ status: "launch_skipped", sessionId, reason: "no_transcript_path" });
    return;
  }

  const worker = fileURLToPath(new URL("./worker.js", import.meta.url));
  const child = spawn(process.execPath, [worker, transcriptPath, sessionId, cwd], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  logEvent({ status: "launch", sessionId, pid: child.pid });
}

main();
