import { SYSTEM_PROMPT } from "./extract.js";

const CHAT_MODEL = "qwen/qwen3-next-80b-a3b-instruct";
const CHAT_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const EMBED_MODEL = "nvidia/nv-embedqa-e5-v5";
const EMBED_ENDPOINT = "https://integrate.api.nvidia.com/v1/embeddings";
const EMBED_DIMENSIONS = 1024;

// Send the dialogue to the same NIM chat model the save pipeline uses for
// summaries, asking for structured learnings. Returns the raw model text;
// parsing/validation lives in extract.ts.
export async function extractLearnings(apiKey: string, userPrompt: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new Error(`nim_chat_failed: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`nim_chat_http_${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// E5 is asymmetric: stored documents use input_type "passage" (queries use
// "query"). The recall MCP search tool embeds queries; this embeds passages so
// the two land in the same space.
export async function embedPassage(apiKey: string, text: string): Promise<number[]> {
  let res: Response;
  try {
    res = await fetch(EMBED_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: text,
        input_type: "passage",
        encoding_format: "float",
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Error(`embed_failed: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`embed_http_${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = data.data?.[0]?.embedding;
  if (!vec || vec.length !== EMBED_DIMENSIONS) {
    throw new Error(`embed_bad_shape: ${vec?.length}`);
  }
  return vec;
}
