import { z } from "zod";
import type { Turn } from "./transcript.js";

export const learningSchema = z.object({
  kind: z.enum(["decision", "correction", "gotcha"]),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  why: z.string().optional(),
  howToApply: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export type LearningInput = z.infer<typeof learningSchema>;

export const SYSTEM_PROMPT = `You extract durable, reusable learnings from a coding session transcript between a USER and an ASSISTANT.

Capture only things worth remembering across future sessions:
- decision: a choice that was made and the reasoning (architecture, library, naming, approach).
- correction: feedback the user gave that should change future behavior, with the why.
- gotcha: a non-obvious technical pitfall, constraint, or failure mode discovered in this session.

Do NOT capture: small talk, restatements of the task, anything obvious from reading the code, or one-off facts with no future value. Prefer a few high-signal entries over many weak ones. If nothing is worth keeping, return [].

Return STRICT JSON: an array of objects with this shape, nothing else, no prose, no code fences:
[
  {
    "kind": "decision | correction | gotcha",
    "title": "short, specific, searchable",
    "body": "the learning, self-contained, makes sense without the transcript",
    "why": "the reasoning (optional, include when it adds context)",
    "howToApply": "concrete guidance for next time (optional)",
    "tags": ["3-6 lowercase kebab-case tags"]
  }
]`;

// Cap the dialogue we send to NIM. Keeps the most recent turns, which carry
// the decisions and corrections, within model context and cost limits.
const MAX_PROMPT_CHARS = 24_000;

export function buildExtractionPrompt(turns: Turn[]): string {
  const dialogue = turns
    .map((t) => `${t.role === "user" ? "USER" : "ASSISTANT"}: ${t.text}`)
    .join("\n\n");
  const capped = dialogue.length > MAX_PROMPT_CHARS ? dialogue.slice(-MAX_PROMPT_CHARS) : dialogue;
  return `CONVERSATION:\n\n${capped}`;
}

export function parseExtraction(modelOutput: string): LearningInput[] {
  const cleaned = stripCodeFences(modelOutput.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: LearningInput[] = [];
  for (const item of parsed) {
    const result = learningSchema.safeParse(item);
    if (result.success) out.push(result.data);
  }
  return out;
}

function stripCodeFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}
