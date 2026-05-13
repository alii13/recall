import { createHash } from "node:crypto";
import type { SourceType } from "./types.js";

const TRACKING_PARAM_PREFIX = /^utm_/i;
const TRACKING_PARAMS = new Set([
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "ref_url",
]);

export function normalizeUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`invalid url: ${input}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsupported scheme: ${parsed.protocol}`);
  }

  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = "";

  const kept: [string, string][] = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (TRACKING_PARAM_PREFIX.test(key)) continue;
    if (TRACKING_PARAMS.has(key.toLowerCase())) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const next = new URLSearchParams();
  for (const [k, v] of kept) next.append(k, v);
  parsed.search = next.toString();

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

export function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

const HOST_ROUTES: Record<string, SourceType> = {
  "reddit.com": "reddit",
  "www.reddit.com": "reddit",
  "old.reddit.com": "reddit",
  "np.reddit.com": "reddit",
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "m.youtube.com": "youtube",
  "youtu.be": "youtube",
  "x.com": "twitter",
  "twitter.com": "twitter",
  "mobile.twitter.com": "twitter",
  "github.com": "github",
  "news.ycombinator.com": "hackernews",
};

export function routeUrl(url: string): SourceType {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "article";
  }
  return HOST_ROUTES[parsed.hostname.toLowerCase()] ?? "article";
}
