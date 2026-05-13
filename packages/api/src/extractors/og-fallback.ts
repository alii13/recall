import type { ExtractedContent } from "@recall/shared";
import { parse } from "node-html-parser";

const EMPTY: ExtractedContent = {
  title: null,
  author: null,
  publishedAt: null,
  markdown: null,
  status: "degraded",
};

export async function extractOg(url: string): Promise<ExtractedContent> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; recall/0.1)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return EMPTY;

  const html = await res.text();
  const root = parse(html);
  const meta = (prop: string) =>
    root.querySelector(`meta[property="${prop}"]`)?.getAttribute("content") ?? null;

  const title = meta("og:title") ?? root.querySelector("title")?.text?.trim() ?? null;
  const description = meta("og:description") ?? meta("description") ?? null;
  const siteName = meta("og:site_name") ?? null;
  const ogUrl = meta("og:url") ?? url;

  if (!title && !description) return EMPTY;

  const lines: string[] = [];
  if (title) lines.push(`# ${title}`, "");
  if (siteName) lines.push(`From ${siteName}`, "");
  if (description) lines.push(description, "");
  lines.push(`Source: ${ogUrl}`);

  return {
    title,
    author: null,
    publishedAt: null,
    markdown: lines.join("\n"),
    status: "degraded",
  };
}
