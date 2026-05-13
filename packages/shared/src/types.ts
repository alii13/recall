export type SourceType =
  | "reddit"
  | "youtube"
  | "twitter"
  | "github"
  | "hackernews"
  | "article"
  | "unknown";

export type ExtractionStatus = "pending" | "ok" | "degraded" | "failed";

export type ExtractedContent = {
  title: string | null;
  author: string | null;
  publishedAt: Date | null;
  markdown: string | null;
  status: "ok" | "degraded";
};
