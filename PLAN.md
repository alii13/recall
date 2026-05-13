# Recall - personal save-to-Claude corpus

> **Status:** built and deployed. This document is the design rationale and execution plan, kept up to date with reality. For user-facing setup, see `README.md`.

## 1. Context

You are building a personal tool for a single user (Shekh, AI engineer at Atlan, uses Claude Code daily). It captures URLs the user shares from iOS / Mac, extracts content, summarizes with an LLM, embeds for semantic search, and exposes the corpus as MCP tools so Claude Code can search the user's saved content during normal work.

There is no end-user app, no web UI, no multi-tenancy. The user is the only user. Claude Code is the only consumption surface. Build accordingly.

**Mental model:** capture pipeline on one side, MCP server on the other side, one Postgres in the middle. That's the whole product.

**Why this exists:** the user already shares links to themselves (WhatsApp, Notes). Those links lose context and never get revisited. This tool ingests them into a corpus that Claude can query as a tool during real work, so the user gets value from saves without having to remember they exist.

## 2. Working rules (read /Users/shekh/.claude/CLAUDE.md, these are highlights)

These apply to every file you write:

- **No em dashes anywhere.** Use spaced hyphens (` - `).
- **No comments** unless the *why* is non-obvious. No "this function does X" comments. No "added for Y" comments.
- **No speculative abstractions.** Three concrete examples before extracting a helper. Two is not a pattern.
- **No error handling for scenarios that cannot happen.** Trust internal code. Only validate at system boundaries (HTTP body, external API responses).
- **Minimum code that solves the problem.** If you wrote 200 lines and it could be 50, rewrite it.
- **TDD where it adds value.** Tests for URL normalization, dedupe, source routing, schema migrations. Skip tests for thin HTTP plumbing and one-shot LLM calls.
- **Sentence case headers, not title case.** Applies to docs you write.
- **Stage files explicitly. Never `git add .`. Never `--no-verify`.**
- **Surgical changes.** Don't refactor adjacent code.
- **Ask before destructive ops** (dropping tables, deleting deployments, force-pushing).

## 3. Scope

### In scope (v0)

- HTTP endpoint that accepts `{url, note?}` and stores a card.
- Source-specific extractors for Reddit, YouTube. Generic extractor (Jina Reader) for everything else. X/Twitter via oEmbed (single tweet only, threads degraded).
- Qwen-generated (via NVIDIA NIM) summary + tags + "why useful" per card.
- NVIDIA NIM embeddings (`nv-embedqa-e5-v5`, 1024 dim) stored in pgvector with HNSW cosine index.
- MCP server with three tools: `search_saved`, `recent_saves`, `get_card`.
- Apple Shortcut spec (one page of instructions, not code).
- Deployment to a small Linux host (recall ships on EC2 t4g.micro) behind Cloudflare Tunnel.

### Explicitly out of scope (do not build)

- Web UI of any kind.
- Auth beyond a single shared secret.
- Multi-user support.
- iOS native app or Share Extension (Shortcut is enough).
- Twitter thread expansion.
- PDF parsing, OCR, image extraction.
- Tag hierarchies, folders, manual organization.
- Resurfacing email / weekly digest (deferred to Phase 6, only if Phase 1-5 ship and get used).

If you find yourself building anything in the second list, stop and ask.

## 4. Architecture

```
iOS Shortcut / Raycast / curl
            │
            ▼
   https://recall.<your-domain>  (TLS terminated at Cloudflare edge)
            │
            ▼  outbound tunnel (no inbound SG rules needed)
   cloudflared on EC2 → http://localhost:8080
            │
            ▼
   POST /save  (Hono, recall-api on EC2)
            │
            ▼
   Insert card (status=pending), return 200 immediately
            │
            ▼
   Background task on same process (setImmediate):
      ├─ route by hostname → extractor
      ├─ extractor → { title, author, published_at, markdown }
      ├─ Qwen on NVIDIA NIM → { summary, tags, why_useful }
      ├─ nv-embedqa-e5-v5 → embedding(title + summary + tags)
      └─ update card (status=ok)
            │
            ▼
       Postgres + pgvector (Neon)
            │
            ▼
   MCP server (separate process, stdio transport)
   exposes: search_saved, recent_saves, get_card
            │
            ▼
   Claude Code calls these tools during normal use
```

Two deployables:
1. **`recall-api`**: HTTP server on EC2 (or any always-on host) behind Cloudflare Tunnel. Auth via shared secret. systemd unit on the host.
2. **`recall-mcp`**: MCP server, runs locally on the user's Mac via stdio, connects to the same Postgres directly (does not go through the public API).

Both live in one monorepo, share types and DB layer.

## 5. Stack (these choices are made, do not relitigate)

- **Language:** TypeScript, Node 20+, ESM modules.
- **Package manager:** pnpm.
- **HTTP framework:** Hono (`hono`).
- **DB:** Postgres (Neon free tier) with `pgvector` extension.
- **ORM:** Drizzle (`drizzle-orm`, `drizzle-kit`).
- **LLM summary:** NVIDIA NIM (`integrate.api.nvidia.com`, OpenAI-compatible), model `qwen/qwen3-next-80b-a3b-instruct` (Qwen3 80B MoE with 3B active params; clean JSON output, ~5s end-to-end on free tier). Originally planned `qwen/qwen3.5-397b-a17b` but it hit cold-start timeouts (>45s) on the free tier. 80B-a3b is plenty for 3-sentence summary + 5 tags + 1-line why-useful. Called via `fetch` directly (no SDK dep).
- **Embeddings:** NVIDIA API, model `nvidia/nv-embedqa-e5-v5` (1024 dims, free tier).
- **Generic extractor:** Jina Reader (`https://r.jina.ai/<url>`, free tier with API key).
- **YouTube transcripts:** `youtube-transcript` npm package.
- **MCP:** `@modelcontextprotocol/sdk`, stdio transport.
- **Tests:** Vitest.
- **Lint/format:** Biome (`@biomejs/biome`). One tool, fast, no config wars.
- **Hosting:** Dedicated EC2 (`ap-south-1`, Ubuntu 24.04, t4g.micro) reached via Cloudflare Tunnel. No EIP, no inbound ports, no nginx, no certbot. `cloudflared` runs as a `systemd` unit on the EC2, establishes an outbound tunnel to Cloudflare, which terminates TLS at the edge for `recall.<your-domain>` (DNS managed by Cloudflare). MCP runs locally on the Mac.
- **Secrets:** `/etc/recall-api.env` on the EC2 (root-only read), `.env` locally (gitignored).

## 6. Prerequisites (ask the user to confirm before building)

The user must have or create:

1. **NVIDIA API key** (for both summary LLM and embeddings; free tier from `build.nvidia.com`).
2. **Jina Reader API key** (free tier; sign up at jina.ai).
3. **Neon account** with a Postgres database, pgvector enabled.
4. **A small always-on Linux host** (recall ships on EC2 t4g.micro in `ap-south-1`, but anything with outbound network works - Hetzner, DigitalOcean, an old laptop on your home network). With Cloudflare Tunnel you don't need a static public IP or open inbound ports.
5. **A domain on Cloudflare** for a subdomain like `recall.<yourdomain>`. Cloudflare's free DNS is enough; if your domain is at another registrar, move DNS to Cloudflare (nameserver change, one-time).
6. **Claude Code** installed on the Mac that will run the MCP server.

Stop and confirm before Phase 1 starts. Do not assume any of these exist.

## 7. Project layout

```
recall/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── .env.example
├── .gitignore
├── README.md                  # short: what is this, how to run
├── packages/
│   ├── shared/                # types, db schema, env loader
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── env.ts
│   │   │   ├── db/
│   │   │   │   ├── client.ts
│   │   │   │   ├── schema.ts
│   │   │   │   └── migrations/
│   │   │   ├── url.ts          # normalize, hash, route
│   │   │   └── types.ts
│   │   └── drizzle.config.ts
│   ├── api/                   # HTTP capture endpoint
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts         # Hono app + server start
│   │   │   ├── routes/save.ts
│   │   │   ├── pipeline/
│   │   │   │   ├── process.ts      # orchestrates extract -> summarize -> embed
│   │   │   │   ├── summarize.ts    # NVIDIA NIM (Qwen) call
│   │   │   │   └── embed.ts        # NVIDIA NIM embedding call
│   │   │   └── extractors/
│   │   │       ├── index.ts        # router
│   │   │       ├── reddit.ts
│   │   │       ├── youtube.ts
│   │   │       ├── twitter.ts
│   │   │       └── generic.ts      # Jina Reader
│   │   └── scripts/
│   │       ├── extractor-smoke.ts   # one-URL-per-extractor smoke test
│   │       └── pipeline-smoke.ts    # E2E pipeline smoke test
│   └── mcp/                   # MCP server
│       ├── package.json
│       └── src/
│           ├── index.ts
│           └── tools/
│               ├── search.ts
│               ├── recent.ts
│               └── get.ts
└── scripts/
    ├── seed-test-saves.ts     # for dogfooding
    └── reembed-all.ts         # if you ever change embedding model
```

Three packages: `shared`, `api`, `mcp`. `shared` exposes `db`, `types`, `env`, `url`. The other two depend on `shared`. No circular deps.

## 8. Database schema

Drizzle schema in `packages/shared/src/db/schema.ts`:

```ts
import { pgTable, uuid, text, timestamp, integer, vector } from "drizzle-orm/pg-core";

export const cards = pgTable("cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  urlHash: text("url_hash").notNull().unique(),
  title: text("title"),
  author: text("author"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  sourceType: text("source_type").notNull(),
  markdown: text("markdown"),
  summary: text("summary"),
  whyUseful: text("why_useful"),
  tags: text("tags").array().notNull().default([]),
  embedding: vector("embedding", { dimensions: 1024 }),
  note: text("note"),
  extractionStatus: text("extraction_status").notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  accessCount: integer("access_count").notNull().default(0),
});
```

Required SQL after migration (manually apply via `psql` or migration file):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE INDEX IF NOT EXISTS cards_embedding_idx
  ON cards USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS cards_created_at_idx
  ON cards (created_at DESC);
CREATE INDEX IF NOT EXISTS cards_source_type_idx
  ON cards (source_type);
```

**`source_type` values:** `reddit`, `youtube`, `twitter`, `github`, `hackernews`, `article`, `unknown`.

**`extraction_status` values:** `pending`, `ok`, `degraded`, `failed`.
- `ok`: full markdown + summary + embedding.
- `degraded`: only OG metadata (title, description, image). No body. No embedding (or embedding of title+description).
- `failed`: nothing usable. Card still exists with URL.

## 9. API contracts

### HTTP

**`POST /save`**

Headers: `X-Save-Token: <shared secret>`, `Content-Type: application/json`.

Body:
```json
{ "url": "https://...", "note": "optional free text" }
```

Behavior:
1. Normalize URL, compute hash.
2. If card with that hash exists, return its id immediately (status 200), no reprocessing.
3. Otherwise insert with `extraction_status=pending`, return id.
4. Fire-and-forget background task to process. Failures update the card's `extraction_status` and `error_message`; the response has already been sent.

Response:
```json
{ "card_id": "uuid", "deduped": false }
```

Errors:
- 401 if token missing/wrong.
- 400 if body is malformed or URL is not a valid http(s) URL.
- 500 only for unexpected DB errors. Do not surface extraction errors here.

**`GET /healthz`** → `{ ok: true }`. No auth.

**`GET /cards/:id`** (debug only, behind same auth). Returns the full card row. Useful for testing the pipeline. Mark this as `internal` in the README - it's not meant for normal use.

### MCP tools

All three return a serializable JSON structure (the MCP SDK wraps it in the tool response).

**`search_saved`**

Input schema:
```ts
{
  query: string,
  limit?: number,    // default 5, max 20
  since_days?: number // optional, filter to last N days
}
```

Behavior:
1. Embed `query` via NVIDIA NIM with `input_type: "query"`.
2. Cosine similarity search in pgvector. Filter `extraction_status IN ('ok', 'degraded')`.
3. If `since_days` set, filter by `created_at >= now() - interval`.
4. Bump `access_count` and `last_accessed_at` for each returned row.
5. Return array of `{ id, url, title, summary, why_useful, source_type, tags, saved_at, score }`.

**`recent_saves`**

Input schema:
```ts
{
  days?: number,         // default 7
  source_type?: string,
  limit?: number         // default 10, max 50
}
```

Behavior: chronological by `created_at desc`, filter by source_type if given, filter by extraction_status. No scoring.

**`get_card`**

Input schema: `{ id: string }`.

Behavior: returns the full card including `markdown`. Bumps access count. Use this when Claude needs the actual content, not just the summary.

## 10. URL handling

In `packages/shared/src/url.ts`. Single source of truth.

```ts
export function normalizeUrl(input: string): string
export function urlHash(normalized: string): string  // sha256, hex
export function routeUrl(normalized: string): SourceType
```

`normalizeUrl`:
- Reject if not http/https.
- Lowercase hostname.
- Drop fragment.
- Drop common tracking params: `utm_*`, `gclid`, `fbclid`, `mc_cid`, `mc_eid`, `ref`, `ref_src`, `ref_url`.
- Drop trailing slash on path (but keep `/` if path is root).
- Sort remaining query params alphabetically.

`routeUrl`:
- `reddit.com`, `old.reddit.com`, `www.reddit.com` → `reddit`
- `youtube.com`, `www.youtube.com`, `youtu.be`, `m.youtube.com` → `youtube`
- `x.com`, `twitter.com`, `mobile.twitter.com` → `twitter`
- `github.com` → `github`
- `news.ycombinator.com` → `hackernews`
- default → `article`

**Test this thoroughly.** This is the one place where bugs are silent and corrupting (dedupe goes wrong, source routing goes wrong, you find out months later). Vitest tests for at least:
- UTM stripping
- Fragment stripping
- Trailing slash normalization
- Param sort stability
- youtu.be vs youtube.com routing
- Mobile vs desktop X
- Case normalization

## 11. Extractors

Each extractor is a function `(normalizedUrl: string) => Promise<ExtractedContent>` where:

```ts
type ExtractedContent = {
  title: string | null;
  author: string | null;
  publishedAt: Date | null;
  markdown: string | null;
  status: "ok" | "degraded";
};
```

### Generic (`generic.ts`)

```
GET https://r.jina.ai/<encoded url>
Headers: Authorization: Bearer <JINA_API_KEY>, X-Return-Format: markdown
```

Returns markdown directly. Parse the first H1 as title if not provided in headers. Jina returns metadata in response headers too (`X-Title`, etc.) - use those when present.

### Reddit (`reddit.ts`)

```
GET <url>.json?limit=20&depth=1
Headers: User-Agent: recall/0.1
```

Parse the JSON. The post is at `[0].data.children[0].data`. Comments are at `[1].data.children`. Build markdown:

```
# <title>

By u/<author> on r/<subreddit>

<selftext>

## Top comments

> <comment.body> - u/<comment.author> (<score> pts)
> ...
```

Take top 10 comments by score, skip those with `<score>` below 5 or `body == "[deleted]"`.

### YouTube (`youtube.ts`)

1. Extract video ID from URL (handle both `youtube.com/watch?v=` and `youtu.be/`).
2. Fetch oEmbed: `https://www.youtube.com/oembed?url=<url>&format=json` for title + author.
3. `youtube-transcript` package for transcript.
4. Build markdown:

```
# <title>

By <author>

URL: <url>

## Transcript

<transcript joined with spaces, paragraphs every ~500 chars>
```

If transcript fails (no captions, age-restricted), degraded with title + author only.

### Twitter (`twitter.ts`)

oEmbed: `https://publish.twitter.com/oembed?url=<url>&omit_script=true`.

Returns HTML. Strip tags, extract text. Status `degraded` because we're not expanding threads.

### Failure / degraded fallback

If the chosen extractor throws or returns null markdown:
1. Try fetching raw HTML of the URL.
2. Parse `<meta property="og:title">`, `og:description`, `og:image`, `og:site_name`.
3. Store with `status=degraded`, `markdown=null`, title/author from OG.

If even OG parsing fails: `status=failed`, store url + error_message.

## 12. Summarization

In `packages/api/src/pipeline/summarize.ts`. One NVIDIA NIM call per save.

Model: `qwen/qwen3-next-80b-a3b-instruct` via the OpenAI-compatible NVIDIA endpoint:

```ts
import OpenAI from "openai";
const client = new OpenAI({
  apiKey: env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});
```

Request JSON object response if the model supports `response_format: { type: "json_object" }`. Otherwise prompt for JSON and parse.

Prompt:

```
You are summarizing a piece of content the user saved for later. They are an AI engineer and builder. Return strict JSON with this shape:

{
  "summary": "2-3 sentences. Plain language. What is this and what claim or content does it carry? No preamble.",
  "tags": ["3-5 lowercase kebab-case tags. High-level topics, not verbose."],
  "why_useful": "One sentence. Concrete and specific. What would someone use this for or reference it about?"
}

Mark opinion as opinion in the summary if the content is opinionated.
Do not hallucinate facts not present in the content.
Output JSON only. No surrounding prose, no code fences.

---
TITLE: <title or "untitled">
URL: <url>
SOURCE_TYPE: <source_type>
BODY:
<markdown truncated to 8000 chars>
```

Parse the response with `JSON.parse`. If it fails, retry once with a stricter "Return only valid JSON" instruction. If it still fails, mark `extraction_status=degraded` with `error_message="summary_failed"`.

NVIDIA free tier has per-account rate limits. At personal save volume (a few per hour) this is fine. If we ever rate-limit, surface to the user before changing models.

## 13. Embeddings

In `packages/api/src/pipeline/embed.ts`. One NVIDIA call per save.

Model: `nvidia/nv-embedqa-e5-v5`, output dim 1024 (verified 2026-05-12).

Input: `${title}\n\n${summary}\n\nTags: ${tags.join(", ")}`. Do not embed the full markdown - it's too long, noisier, and slower. Title + summary + tags captures the gist for retrieval.

NVIDIA embedding usage (OpenAI-compatible):
```ts
import OpenAI from "openai";
const client = new OpenAI({
  apiKey: env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});
const res = await client.embeddings.create({
  model: "nvidia/nv-embedqa-e5-v5",
  input: text,
  // NVIDIA-specific: pass input_type via extra body
  // @ts-expect-error - NVIDIA extension
  input_type: "passage", // "query" when called from MCP search tool
});
// res.data[0].embedding
```

For queries (in MCP `search_saved`), pass `input_type: "query"` instead of `"passage"`. The `nv-embedqa-e5-v5` model is asymmetric - this matters for retrieval quality. Verify the exact param name at integration time; NVIDIA's docs sometimes show `input_type` and sometimes `query` / `passage` as separate fields.

## 14. Pipeline orchestration

`packages/api/src/pipeline/process.ts`. Called as fire-and-forget after the HTTP response is sent.

```
async function processCard(cardId: string) {
  1. Load card from DB.
  2. Run extractor based on sourceType.
  3. If extractor returns null markdown → try OG fallback → update status accordingly. Return.
  4. Run summarize.
  5. Run embed.
  6. Update card with title, author, published_at, markdown, summary, why_useful, tags, embedding, status=ok.
  7. On any throw inside steps 4-5: log, update status=degraded with what was extracted, error_message.
}
```

No queue, no Redis. For personal scale (a few saves per hour at peak) this is fine. Use `setImmediate(() => processCard(id).catch(logError))` after the response.

If two saves come in at the same time they process in parallel. That's fine.

## 15. MCP server

Stdio transport. The user wires it into Claude Code via `~/.claude.json` or `.mcp.json` in their workspace:

```json
{
  "mcpServers": {
    "recall": {
      "command": "node",
      "args": ["/Users/shekh/recall/packages/mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "...",
        "VOYAGE_API_KEY": "..."
      }
    }
  }
}
```

Three tools, schemas per section 9. Implementation is straightforward:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// ...
```

Tool descriptions need to be specific enough that Claude picks them up when relevant. Example for `search_saved`:

> Search the user's personal saved content corpus (articles, tweets, videos, Reddit threads they've saved). Returns ranked results with summary, title, URL, and tags. Use this whenever the user asks "did I save anything about X" or seems to be referencing prior reading.

## 16. Capture surface: Apple Shortcut

Don't write code. Write a one-page README section that walks the user through:

1. Open Shortcuts app on iOS or macOS.
2. Create new Shortcut, name it "Save to recall."
3. Add action: "Get Contents of URL."
4. Set URL: `https://<fly-app>.fly.dev/save`.
5. Method: POST.
6. Headers: `X-Save-Token: <secret>`, `Content-Type: application/json`.
7. Request body (JSON): `{ "url": "<Shortcut Input>" }`.
8. In settings, enable "Use as Share Sheet action," accept input from URLs and Safari web pages.

Test via Share Sheet from Safari and Twitter. Should return 200 in under 1s (the processing happens async).

## 17. Env vars

`.env.example` checked in:

```
# DB
DATABASE_URL=postgres://...

# Auth (shared secret for /save)
SAVE_TOKEN=

# LLM + embeddings (one key, two uses)
NVIDIA_API_KEY=
JINA_API_KEY=

# Optional
LOG_LEVEL=info
PORT=8080
```

Load with `zod` in `packages/shared/src/env.ts`. Fail fast on missing required vars.

## 18. Execution plan

Build in phases. After each phase, commit and stop to verify with the user before continuing.

### Phase 0: prerequisites (do not skip)

- Confirm all six prerequisites from section 6.
- If anything is missing, list exactly what the user needs to do.
- Create the Neon DB. Enable pgvector. Get the connection string.
- Get all API keys.

**Stop. Show the user the keys/URLs you need them to provide. Do not proceed until they confirm.**

### Phase 1: scaffolding

- Init pnpm workspace.
- Create three packages with their `package.json`, `tsconfig.json`.
- Biome config.
- `.gitignore` (node_modules, dist, .env).
- `.env.example`.
- Empty Drizzle schema, Drizzle config, generate first migration.
- `pnpm install`, `pnpm build` works.
- Commit.

### Phase 2: shared utilities + DB

- `env.ts` with zod parsing.
- `db/client.ts` (Drizzle + node-postgres).
- `db/schema.ts` (full schema from section 8).
- `url.ts` (normalize, hash, route) with Vitest tests.
- Apply migration to Neon DB.
- Apply the manual SQL from section 8 (CREATE EXTENSION, indexes).
- Run tests. Commit.

### Phase 3: extractors

- `extractors/generic.ts` (Jina Reader).
- `extractors/reddit.ts`.
- `extractors/youtube.ts`.
- `extractors/twitter.ts`.
- `extractors/index.ts` (router).
- OG-tag fallback helper.
- Manual smoke test each extractor with one real URL of that type. Save outputs to `scripts/extractor-smoke.ts`.
- Commit.

### Phase 4: pipeline (summarize, embed, orchestrator)

- `pipeline/summarize.ts` (NVIDIA NIM, Qwen).
- `pipeline/embed.ts` (NVIDIA NIM embeddings).
- `pipeline/process.ts` (orchestrator).
- End-to-end smoke test: pass a URL, see a card go from pending to ok with summary + embedding.
- Commit.

### Phase 5: HTTP API

- `routes/save.ts`.
- Auth middleware (constant-time token compare).
- `index.ts` with Hono setup and `setImmediate` fire-and-forget.
- `GET /healthz`, `GET /cards/:id`.
- Local test with `curl`.
- Commit.

### Phase 6: deploy API behind Cloudflare Tunnel

- Provision the host. SSH-accessible Linux. recall ships on an EC2 t4g.micro in `ap-south-1` (security group: SSH only from your laptop IP, no inbound 80/443 needed).
- On the host: `nvm install 20`, `corepack enable && corepack prepare pnpm@9 --activate`, install `cloudflared` from the official `.deb`.
- Rsync the repo source (no `node_modules`, no `dist`), then on the host: `pnpm install --frozen-lockfile && pnpm build`.
- Write `/etc/recall-api.env` with secrets (chmod 600, root-owned).
- Symlink the active node binary to `/usr/local/bin/node` so systemd has a stable path.
- Write `/etc/systemd/system/recall-api.service` (`User=ubuntu`, `EnvironmentFile=/etc/recall-api.env`, `ExecStart=/usr/local/bin/node .../packages/api/dist/index.js`), `systemctl enable --now recall-api`. Verify `curl http://localhost:8080/healthz`.
- `cloudflared tunnel login` (browser auth to Cloudflare; one-time per host) → cert lands at `~/.cloudflared/cert.pem`.
- `cloudflared tunnel create recall` → generates a tunnel + credentials JSON.
- `cloudflared tunnel route dns recall recall.<your-domain>` → creates a CNAME at Cloudflare pointing the subdomain at the tunnel.
- Copy credentials JSON to `/etc/cloudflared/`, write `/etc/cloudflared/config.yml` with `ingress: [{ hostname: recall.<your-domain>, service: http://localhost:8080 }, { service: http_status:404 }]`.
- `sudo cloudflared service install` installs and starts the cloudflared systemd unit.
- From your laptop: `curl https://recall.<your-domain>/healthz` should return `{"ok":true}`. Then `POST /save` with a real URL and verify the card processes end-to-end.
- Commit.

If you prefer the original nginx + Let's Encrypt + Elastic IP path (more conventional, no Cloudflare account required), it's the same idea: open 80/443 in the SG, point an A record at an EIP, run nginx as a reverse proxy with certbot for TLS. Cloudflare Tunnel is the chosen default because it sidesteps EIP cost (~$3.60/month) and removes inbound exposure entirely.

### Phase 7: MCP server

- `packages/mcp/src/index.ts` with three tools.
- Tool implementations call directly into `shared/db`.
- Local test: run server, send tool calls via the MCP inspector or test harness.
- Wire into the user's Claude Code config.
- Verify Claude actually calls the tool when asked "did I save anything about X."
- Commit.

### Phase 8: Apple Shortcut + README

- Write the README section with Shortcut setup.
- User builds the Shortcut.
- End-to-end test: share a tweet from Safari → 200 response → card appears in DB → Claude can find it via `search_saved`.

### Phase 9 (deferred, only if Phase 1-8 ship and get used for 2+ weeks)

- Daily/weekly briefing cron.
- Reembed script for model upgrades.
- Web inbox if the user actually misses it (probably won't).

## 19. Testing approach

TDD where it pays: URL normalization, source routing, dedupe behavior.

Skip tests for: thin HTTP plumbing, LLM calls (mock the SDK at a higher level if you really want, but for v0 don't bother), MCP wiring.

Integration test (one, end-to-end): seed a Reddit URL, run the pipeline, assert the card lands with `status=ok`, `summary` non-null, `embedding` non-null, and `search_saved("...")` returns it.

Run with `pnpm test`. CI is out of scope for v0.

## 20. Decision points (stop and ask the user)

These are the moments where you should pause, not guess:

- Phase 0: which Neon region? (Default: `aws-ap-south-1` to match EC2; falls back to nearest available on free tier).
- Phase 0: which subdomain for the API? User must own a domain and add a DNS A record.
- Phase 3: if Jina Reader's free tier rate-limits during smoke testing, ask before paying or switching providers.
- Phase 4: if NVIDIA JSON parsing fails repeatedly on certain content types, surface to the user before changing the prompt or model.
- Phase 4: if NVIDIA rate-limits during normal use, surface before swapping models or paying.
- Phase 6: dockerized deploy vs bare-metal `systemd`. Default is `systemd` (simpler given the EC2 already has running processes); ask before introducing Docker.
- Phase 7: stdio MCP vs HTTP MCP. Default is stdio; ask if the user wants HTTP (would let them use the corpus from claude.ai web too).
- Anything that requires creating a paid account on the user's behalf.

## 21. Done criteria

V0 is done when:

- User shares a tweet from Safari → card lands in DB within 10s with summary + embedding.
- User asks Claude Code: "any recent stuff I saved about <topic>" → Claude calls `search_saved`, returns the right card.
- User asks: "summarize what I saved this week" → Claude calls `recent_saves`, summarizes inline.
- Dedupe works: sharing the same URL twice creates one card.
- Extraction failures degrade gracefully (card exists, marked degraded, OG metadata only).
- `fly logs` shows no errors during normal operation.
- README is enough for the user to set up the Shortcut and re-deploy if they break the Fly app.

That's the bar. Don't gold-plate past it.

## 22. Things you might be tempted to add - don't

- A web UI to "see" the cards. The user can `psql` if they want to look.
- A "edit card" flow. Cards are immutable in v0.
- Image OCR / thumbnails. No.
- A queue (BullMQ, etc.). `setImmediate` is fine at this scale.
- Multi-region DB. No.
- Rate limiting on `/save`. The user is the only caller; the shared secret is the rate limit.
- Observability beyond `pino` logs. No Sentry, no OTel, no Grafana.

If you're unsure whether something is in scope, the answer is no. Ask before adding.

## 23. Setup prerequisites (for someone deploying their own recall)

1. **NVIDIA API key** from [build.nvidia.com](https://build.nvidia.com) - free tier covers summary LLM + embeddings.
2. **Neon Postgres** project at [neon.tech](https://neon.tech) with `CREATE EXTENSION IF NOT EXISTS vector;` run once. Free tier sufficient.
3. **Jina Reader API key** at [jina.ai/reader](https://jina.ai/reader) - optional; works keyless at lower rate limit.
4. **Small Linux host** with outbound internet. recall ships on EC2 t4g.micro in `ap-south-1`; anything similar works (Hetzner, DigitalOcean, even a home server).
5. **A domain managed by Cloudflare DNS** - any TLD, free Cloudflare account. If your domain is at another registrar, change nameservers to Cloudflare's (one-time).
6. **Claude Code** installed on the Mac that will run the MCP server.

See README.md for the full setup walkthrough.
