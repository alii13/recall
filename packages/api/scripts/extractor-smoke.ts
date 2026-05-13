import { normalizeUrl } from "@recall/shared";
import { extract } from "../src/extractors/index.js";

const TARGETS: { url: string; expect: string }[] = [
  {
    url: "https://www.reddit.com/r/MachineLearning/",
    expect: "reddit",
  },
  { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", expect: "youtube" },
  { url: "https://x.com/AnthropicAI/status/1856042307493994648", expect: "twitter" },
  { url: "https://en.wikipedia.org/wiki/Retrieval-augmented_generation", expect: "article" },
];

const jinaApiKey = process.env.JINA_API_KEY;

for (const { url, expect } of TARGETS) {
  const normalized = normalizeUrl(url);
  console.log(`\n=== ${expect.toUpperCase()} ===`);
  console.log(`url: ${normalized}`);
  const start = Date.now();
  try {
    const result = await extract(normalized, { jinaApiKey });
    const dur = Date.now() - start;
    console.log(`source: ${result.sourceType} | status: ${result.status} | ${dur}ms`);
    console.log(`title: ${result.title ?? "(none)"}`);
    console.log(`author: ${result.author ?? "(none)"}`);
    console.log(`md length: ${result.markdown?.length ?? 0}`);
    if (result.markdown) {
      const preview = result.markdown.slice(0, 300).replace(/\n/g, "\n  ");
      console.log(`preview:\n  ${preview}${result.markdown.length > 300 ? "..." : ""}`);
    }
  } catch (e) {
    console.log(`ERROR: ${(e as Error).message}`);
  }
}
