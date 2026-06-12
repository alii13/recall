#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDb } from "@recall/shared";
import { getInputSchema, makeGetTool } from "./tools/get.js";
import { makeSearchLearningsTool, searchLearningsInputSchema } from "./tools/learnings.js";
import { makeRecentTool, recentInputSchema } from "./tools/recent.js";
import { makeSearchTool, searchInputSchema } from "./tools/search.js";

const dbUrl = process.env.DATABASE_URL;
const nvidiaApiKey = process.env.NVIDIA_API_KEY;
if (!dbUrl || !nvidiaApiKey) {
  console.error("recall-mcp: DATABASE_URL and NVIDIA_API_KEY env vars required");
  process.exit(1);
}

const { db } = createDb(dbUrl);

const server = new McpServer({
  name: "recall",
  version: "0.1.0",
});

server.registerTool(
  "search_saved",
  {
    description:
      "Search the user's personal saved-content corpus (articles, tweets, videos, Reddit threads they've saved over time) by semantic similarity. Returns ranked results with title, URL, summary, tags, and a relevance score. Use this whenever the user asks 'did I save anything about X', references prior reading, or wants context that might live in their saves.",
    inputSchema: searchInputSchema,
  },
  makeSearchTool({ db, nvidiaApiKey }),
);

server.registerTool(
  "recent_saves",
  {
    description:
      "List the user's most recently saved content in chronological order. Use this when the user asks 'what did I save this week', 'what have I been reading lately', or wants a chronological recap. Can be filtered to a single source type.",
    inputSchema: recentInputSchema,
  },
  makeRecentTool(db),
);

server.registerTool(
  "get_card",
  {
    description:
      "Fetch the full content (including the markdown body) of a specific saved card by its UUID. Use this after search_saved or recent_saves when you need to read the actual article text, not just the summary.",
    inputSchema: getInputSchema,
  },
  makeGetTool(db),
);

server.registerTool(
  "search_learnings",
  {
    description:
      "Search the user's accumulated learnings from past Claude Code sessions - decisions they've made, corrections they've given, and gotchas discovered - captured at session end and reviewed by the user. Returns ranked learnings with kind, title, body, why, how-to-apply, project, tags, and a relevance score. Call this when starting work on a project to recall prior decisions, when the user references something they 'decided earlier' or 'told you before', or to avoid repeating a past mistake. Distinct from search_saved: that searches saved articles and URLs; this searches the user's own working decisions and corrections.",
    inputSchema: searchLearningsInputSchema,
  },
  makeSearchLearningsTool({ db, nvidiaApiKey }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
