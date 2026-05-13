import type { ExtractedContent } from "@recall/shared";
import { YoutubeTranscript } from "youtube-transcript";

const EMPTY: ExtractedContent = {
  title: null,
  author: null,
  publishedAt: null,
  markdown: null,
  status: "degraded",
};

export async function extractYoutube(url: string): Promise<ExtractedContent> {
  const videoId = parseVideoId(url);
  if (!videoId) return EMPTY;

  const { title, author } = await fetchOEmbed(url);

  let transcript: string | null = null;
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    transcript = items.map((i) => i.text).join(" ").trim();
  } catch {
    transcript = null;
  }

  const lines: string[] = [`# ${title ?? "Untitled"}`, ""];
  if (author) lines.push(`By ${author}`, "");
  lines.push(`URL: ${url}`, "");
  if (transcript) {
    lines.push("## Transcript", "", paragraphize(transcript, 500));
  }

  return {
    title,
    author,
    publishedAt: null,
    markdown: lines.join("\n"),
    status: transcript ? "ok" : "degraded",
  };
}

function parseVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

async function fetchOEmbed(url: string): Promise<{ title: string | null; author: string | null }> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return { title: null, author: null };
    const data = (await res.json()) as { title?: string; author_name?: string };
    return { title: data.title ?? null, author: data.author_name ?? null };
  } catch {
    return { title: null, author: null };
  }
}

function paragraphize(text: string, charsPerPara: number): string {
  const paragraphs: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (current.length + word.length + 1 > charsPerPara) {
      paragraphs.push(current.trim());
      current = "";
    }
    current += `${word} `;
  }
  if (current.trim()) paragraphs.push(current.trim());
  return paragraphs.join("\n\n");
}
