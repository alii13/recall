import type { ExtractedContent } from "@recall/shared";

const EMPTY: ExtractedContent = {
  title: null,
  author: null,
  publishedAt: null,
  markdown: null,
  status: "degraded",
};

export async function extractTwitter(url: string): Promise<ExtractedContent> {
  try {
    const res = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const data = (await res.json()) as { html?: string; author_name?: string };
      if (data.html) {
        const text = stripHtml(data.html);
        const author = data.author_name ?? null;
        return {
          title: text.slice(0, 80) || null,
          author,
          publishedAt: null,
          markdown: [`# Tweet by ${author ?? "unknown"}`, "", text, "", `Source: ${url}`].join("\n"),
          status: "degraded",
        };
      }
    }
  } catch {
    // fall through to URL-based fallback
  }

  return fromUrlOnly(url);
}

function fromUrlOnly(url: string): ExtractedContent {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const username = parts[0];
    if (!username) return EMPTY;
    return {
      title: `Tweet by @${username}`,
      author: `@${username}`,
      publishedAt: null,
      markdown: `# Tweet by @${username}\n\nSource: ${url}\n\n(content unavailable - X requires authentication)`,
      status: "degraded",
    };
  } catch {
    return EMPTY;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
