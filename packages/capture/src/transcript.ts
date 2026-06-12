import { basename } from "node:path";

export type Turn = { role: "user" | "assistant"; text: string };

type ContentBlock = { type?: string; text?: string };
type TranscriptLine = {
  type?: string;
  isSidechain?: boolean;
  message?: { role?: string; content?: string | ContentBlock[] };
};

// Parse a Claude Code transcript (JSONL) into a clean user/assistant dialogue.
// Keeps only `text` blocks: thinking, tool_use, tool_result, and images are
// dropped. Dropping tool output also keeps command results (where leaked
// secrets tend to surface) out of anything we send downstream. Sidechain
// (subagent) lines are skipped so we capture the main thread only.
export function parseTranscript(jsonl: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let obj: TranscriptLine;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.isSidechain) continue;
    const role = obj.message?.role;
    if (role !== "user" && role !== "assistant") continue;

    const content = obj.message?.content;
    const text = typeof content === "string" ? content : textBlocks(content);
    if (text.trim()) turns.push({ role, text: text.trim() });
  }
  return turns;
}

function textBlocks(blocks: ContentBlock[] | undefined): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

// Derive a project slug from the session cwd. The home dir (no project
// context) maps to null so those captures stay global rather than mislabelled.
export function projectFromCwd(cwd: string | undefined, home = process.env.HOME): string | null {
  if (!cwd) return null;
  const normalized = cwd.replace(/\/+$/, "");
  if (!normalized || (home && normalized === home.replace(/\/+$/, ""))) return null;
  return basename(normalized) || null;
}
