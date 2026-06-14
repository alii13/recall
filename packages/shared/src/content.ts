import type { ExtractedContent } from "./types.js";

const TITLE_MAX = 80;

/**
 * Build extracted content from text the client already rendered (e.g. the
 * DOM of an authenticated browser tab passed in on save). This bypasses the
 * server-side fetch, which is the only way to get content for sources that
 * block logged-out clients (X, Reddit).
 */
export function providedContent(text: string): ExtractedContent {
  const clean = text.replace(/\r\n/g, "\n").trim();
  const firstLine = clean
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return {
    title: firstLine ? firstLine.slice(0, TITLE_MAX) : null,
    author: null,
    publishedAt: null,
    markdown: clean || null,
    status: "ok",
  };
}
