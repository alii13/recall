import { type ExtractedContent, routeUrl } from "@recall/shared";
import { extractGeneric } from "./generic.js";
import { extractOg } from "./og-fallback.js";
import { extractReddit } from "./reddit.js";
import { extractTwitter } from "./twitter.js";
import { extractYoutube } from "./youtube.js";

export type ExtractOpts = { jinaApiKey?: string };

export type ExtractResult = ExtractedContent & {
  sourceType: ReturnType<typeof routeUrl>;
};

export async function extract(url: string, opts: ExtractOpts = {}): Promise<ExtractResult> {
  const sourceType = routeUrl(url);
  const primaryIsJina = sourceType !== "reddit" && sourceType !== "youtube" && sourceType !== "twitter";

  const primary = await safe(async () => {
    switch (sourceType) {
      case "reddit":
        return await extractReddit(url);
      case "youtube":
        return await extractYoutube(url);
      case "twitter":
        return await extractTwitter(url);
      default:
        return await extractGeneric(url, opts.jinaApiKey);
    }
  });
  if (primary.markdown) return { ...primary, sourceType };

  if (!primaryIsJina && sourceType !== "twitter") {
    const jina = await safe(() => extractGeneric(url, opts.jinaApiKey));
    if (jina.markdown) return { ...jina, sourceType };
  }

  const og = await safe(() => extractOg(url));
  return { ...og, sourceType };
}

async function safe(fn: () => Promise<ExtractedContent>): Promise<ExtractedContent> {
  try {
    return await fn();
  } catch {
    return { title: null, author: null, publishedAt: null, markdown: null, status: "degraded" };
  }
}
