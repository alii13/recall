import type { ExtractedContent } from "@recall/shared";

const EMPTY: ExtractedContent = {
  title: null,
  author: null,
  publishedAt: null,
  markdown: null,
  status: "degraded",
};

export async function extractGeneric(
  url: string,
  apiKey?: string,
): Promise<ExtractedContent> {
  const headers: Record<string, string> = { "X-Return-Format": "markdown" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return EMPTY;

  const markdown = (await res.text()).trim();
  if (markdown.length < 100) return EMPTY;

  const title = res.headers.get("x-title") ?? extractFirstH1(markdown);

  return {
    title,
    author: null,
    publishedAt: null,
    markdown,
    status: "ok",
  };
}

function extractFirstH1(md: string): string | null {
  const m = md.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim() ?? null;
}
