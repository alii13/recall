const SYSTEM_PROMPT = `You are summarizing a piece of content the user saved for later. They are an AI engineer and builder. Return strict JSON with this shape:

{
  "summary": "2-3 sentences. Plain language. What is this and what claim or content does it carry? No preamble.",
  "tags": ["3-5 lowercase kebab-case tags. High-level topics, not verbose."],
  "why_useful": "One sentence. Concrete and specific. What would someone use this for or reference it about?"
}

Mark opinion as opinion in the summary if the content is opinionated.
Do not hallucinate facts not present in the content.
Output JSON only. No surrounding prose, no code fences.`;

const MODEL = "qwen/qwen3-next-80b-a3b-instruct";
const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

export type SummaryInput = {
  title: string | null;
  url: string;
  sourceType: string;
  markdown: string;
};

export type SummaryResult = {
  summary: string;
  tags: string[];
  whyUseful: string;
};

export async function summarize(apiKey: string, content: SummaryInput): Promise<SummaryResult> {
  const userPrompt = [
    `TITLE: ${content.title ?? "untitled"}`,
    `URL: ${content.url}`,
    `SOURCE_TYPE: ${content.sourceType}`,
    "BODY:",
    content.markdown.slice(0, 8000),
  ].join("\n");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const stricter = attempt > 0;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: stricter
              ? `${SYSTEM_PROMPT}\n\nYour previous response was not valid JSON. Output ONLY a JSON object, nothing else.`
              : SYSTEM_PROMPT,
          },
          { role: "user", content: userPrompt },
        ],
        temperature: stricter ? 0 : 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      lastError = new Error(`nim_http_${res.status}: ${await res.text()}`);
      continue;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const cleaned = stripCodeFences(raw);

    try {
      const parsed = JSON.parse(cleaned) as {
        summary?: unknown;
        tags?: unknown;
        why_useful?: unknown;
      };
      if (
        typeof parsed.summary === "string" &&
        Array.isArray(parsed.tags) &&
        typeof parsed.why_useful === "string"
      ) {
        return {
          summary: parsed.summary,
          tags: parsed.tags.filter((t): t is string => typeof t === "string"),
          whyUseful: parsed.why_useful,
        };
      }
      lastError = new Error("invalid_shape");
    } catch (e) {
      lastError = new Error(`parse_failed: ${(e as Error).message}`);
    }
  }
  throw lastError ?? new Error("summary_failed");
}

function stripCodeFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}
