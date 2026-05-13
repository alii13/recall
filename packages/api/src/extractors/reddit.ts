import type { ExtractedContent } from "@recall/shared";

type RedditPost = {
  title?: string;
  author?: string;
  created_utc?: number;
  subreddit?: string;
  selftext?: string;
};

type RedditComment = {
  author?: string;
  body?: string;
  score?: number;
};

type RedditListing<T> = { data?: { children?: { data: T }[] } };

const EMPTY: ExtractedContent = {
  title: null,
  author: null,
  publishedAt: null,
  markdown: null,
  status: "degraded",
};

export async function extractReddit(url: string): Promise<ExtractedContent> {
  const res = await fetch(`${url}.json?limit=20&depth=1`, {
    headers: { "User-Agent": "recall/0.1" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return EMPTY;

  const data = (await res.json()) as [RedditListing<RedditPost>, RedditListing<RedditComment>?];
  const post = data[0]?.data?.children?.[0]?.data;
  if (!post?.title) return EMPTY;

  const subreddit = post.subreddit ?? "unknown";
  const authorName = post.author ?? "unknown";
  const lines: string[] = [`# ${post.title}`, "", `By u/${authorName} on r/${subreddit}`, ""];
  if (post.selftext) {
    lines.push(post.selftext, "");
  }

  const rawComments = data[1]?.data?.children ?? [];
  const topComments = rawComments
    .map((c) => c.data)
    .filter((c): c is RedditComment & { body: string } =>
      Boolean(c.body) && c.body !== "[deleted]" && (c.score ?? 0) >= 5,
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);

  if (topComments.length > 0) {
    lines.push("## Top comments", "");
    for (const c of topComments) {
      const quoted = c.body.split("\n").map((l) => `> ${l}`).join("\n");
      lines.push(`${quoted} - u/${c.author ?? "unknown"} (${c.score ?? 0} pts)`, "");
    }
  }

  return {
    title: post.title,
    author: `u/${authorName}`,
    publishedAt: post.created_utc ? new Date(post.created_utc * 1000) : null,
    markdown: lines.join("\n"),
    status: "ok",
  };
}
