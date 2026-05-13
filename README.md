# recall

A personal save-to-Claude corpus. Capture URLs from iOS or Mac, extract and summarize them, expose the corpus as MCP tools so Claude Code can search them during normal work.

You save links. Claude can search them. That is it.

## What it does

When you share a URL to recall (iOS Share Sheet, Raycast, curl):

1. The API normalizes the URL, dedupes by hash, returns a `card_id` in under 100 ms.
2. A background pipeline fetches the page and extracts clean markdown.
3. Qwen on NVIDIA NIM produces a 2-3 sentence summary, 3-5 tags, and a one-line "why this is useful."
4. `nv-embedqa-e5-v5` produces a 1024-dim embedding of title + summary + tags.
5. Postgres stores everything; pgvector indexes the embedding with HNSW + cosine.

When you later ask Claude "did I save anything about X?" in any Claude Code session, an MCP server embeds your query, runs a cosine search in pgvector, and returns ranked cards.

## Architecture

```mermaid
flowchart TB
    user([you])

    subgraph capture["1 - capture"]
        ios["iOS Shortcut<br/>Share Sheet"]
        rcst["Raycast / curl"]
    end

    subgraph host["2 - API host (any always-on host with HTTPS)"]
        ng["nginx :443<br/>TLS"]
        api["Hono /save<br/>auth, dedupe, insert pending<br/>respond < 100 ms"]
        subgraph pipe["3 - async pipeline"]
            extract["extract<br/>Reddit / YouTube / Twitter<br/>Jina for the long tail"]
            sumr["summarize<br/>Qwen on NVIDIA NIM"]
            embed["embed<br/>nv-embedqa-e5-v5"]
        end
    end

    db[("4 - Postgres + pgvector<br/>cards · hnsw · btree")]

    subgraph mac["5 - your Mac"]
        mcp["MCP server (stdio)<br/>search_saved · recent_saves · get_card"]
        cc["Claude Code"]
    end

    user --> capture --> ng --> api
    api -.->|pending row| db
    api ==>|card_id| pipe
    extract --> sumr --> embed -.->|status = ok| db
    user --> cc <--> mcp <--> db
```

## Components

- `@recall/shared` - Drizzle schema, URL utilities (normalize / hash / route), env loader, DB client
- `@recall/api` - Hono HTTP server with `/save`, custom extractors for Reddit / YouTube / Twitter, Jina-based generic extractor with OG fallback, the summarize-embed-orchestrate pipeline
- `@recall/mcp` - MCP stdio server with three tools: `search_saved`, `recent_saves`, `get_card`

## Setup

### Prerequisites

- Node 20+
- pnpm 9+
- A Postgres database with `pgvector` (Neon free tier works)
- An NVIDIA NIM account at [build.nvidia.com](https://build.nvidia.com) (free tier is enough for personal use)
- Optional: a Jina Reader API key from [jina.ai](https://jina.ai/reader). recall works keyless at a lower rate limit.

### Install

```bash
git clone <this repo>
cd recall
pnpm install
```

### Database

Enable the extension and run the migration:

```sql
-- in your DB's SQL editor
CREATE EXTENSION IF NOT EXISTS vector;
```

```bash
export DATABASE_URL='postgresql://user:pass@host/db?sslmode=require'
pnpm --filter @recall/shared db:migrate
```

This creates one `cards` table with an HNSW index on `embedding` and btree indexes on `created_at` and `source_type`.

### Environment

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `SAVE_TOKEN` | yes | Shared secret for `POST /save`. Generate with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| `NVIDIA_API_KEY` | yes | From build.nvidia.com |
| `JINA_API_KEY` | no | From jina.ai. Without it, recall uses Jina's keyless endpoint. |
| `PORT` | no | Defaults to 8080 |

### Run the API locally

```bash
pnpm build
cd packages/api
set -a; . ../../.env; set +a
node dist/index.js
```

Server listens on `http://localhost:8080`.

```bash
# health check
curl http://localhost:8080/healthz
# {"ok":true}

# save
curl -X POST http://localhost:8080/save \
  -H "Content-Type: application/json" \
  -H "X-Save-Token: $SAVE_TOKEN" \
  -d '{"url":"https://en.wikipedia.org/wiki/Retrieval-augmented_generation"}'
# {"card_id":"...","deduped":false}

# inspect what got saved (debug only, gated on the same token)
curl http://localhost:8080/cards/<id> -H "X-Save-Token: $SAVE_TOKEN"
```

### Deploy the API

You need an always-on host with HTTPS so the iOS Shortcut can hit it. Any will do: EC2, Hetzner, Render, Fly. recall ships no opinionated infra. A minimum recipe on an Ubuntu host:

1. `nvm install 20 && nvm use 20`
2. Copy `packages/api/dist` + `packages/shared/dist` + `node_modules` to the host (or run `pnpm install --prod` there)
3. Put env vars in `/etc/recall-api.env` (chmod 600, root-owned)
4. Run as a `systemd` unit pointing at `node packages/api/dist/index.js`
5. Reverse-proxy via nginx with a Let's Encrypt cert for your subdomain

### Wire the MCP server into Claude Code

Make sure `packages/mcp/dist/index.js` exists (`pnpm build`). Then register globally:

```bash
claude mcp add-json -s user recall '{
  "command": "node",
  "args": ["/absolute/path/to/recall/packages/mcp/dist/index.js"],
  "env": {
    "DATABASE_URL": "postgresql://...",
    "NVIDIA_API_KEY": "nvapi-..."
  }
}'
```

Verify:

```bash
claude mcp get recall
# Status: ✓ Connected
```

Start a fresh `claude` session anywhere. Ask "did I save anything about retrieval augmented generation?". Claude should call `search_saved`.

If natural-language queries route to your built-in auto-memory instead of the recall corpus, add this line to your global `~/.claude/CLAUDE.md`:

> When I mention saved content, prior reading, bookmarks, or ask "did I save anything about X" / "do I have anything on Y" / "what have I been reading", call the `recall` MCP server's `search_saved` first. Only fall back to auto-memory if recall returns nothing relevant.

### iOS Shortcut

1. Open Shortcuts on iOS or macOS.
2. Create a new Shortcut, name it `Save to recall`.
3. Add action: **Get Contents of URL**.
4. Set URL: `https://<your-host>/save`.
5. Method: `POST`.
6. Headers:
   - `X-Save-Token`: your `SAVE_TOKEN` value
   - `Content-Type`: `application/json`
7. Request Body (JSON): `{ "url": "<Shortcut Input>" }` (use the magic variable for input).
8. In Shortcut settings, enable **Use as Share Sheet** and accept **URLs** and **Safari web pages** as input.

Test by sharing a tweet or article from Safari. The Shortcut should complete in well under a second; processing happens async on the server.

## MCP tools

Available in any Claude Code session after wiring:

- **`search_saved(query, limit?, since_days?)`** - semantic search over the embedding column. Returns ranked cards with title, URL, summary, why_useful, tags, score (cosine similarity).
- **`recent_saves(days?, source_type?, limit?)`** - chronological listing. Defaults to last 7 days, top 10. Filter by source_type (`reddit`, `youtube`, `twitter`, `github`, `hackernews`, `article`).
- **`get_card(id)`** - fetch one card with its full markdown body. Use after `search_saved` when you need the actual article text, not just the summary.

## Limitations

- **Twitter / X is severely degraded.** X blocks oEmbed, Jina, and direct HTML scraping for logged-out clients. recall falls back to saving URL + username only. Adding a `note` when you save a tweet makes the summary useful.
- **Reddit's `.json` endpoint is anti-bot-gated.** recall falls through to Jina, which works but takes ~10 s for a single thread.
- **Neon free tier auto-suspends after 5 minutes idle.** First query after suspend takes ~1 s. Other Postgres hosts don't have this.
- **No images, PDFs, OCR, or video frames.** Text content only.
- **Single-user by design.** No auth model beyond one shared secret. No multi-tenancy.

## Limitations by design (not bugs)

- No web UI. Use `psql` if you want to browse cards directly.
- No tags hierarchy or folders. Embeddings + free-form tags do the work.
- No queue / Redis / worker pool. `setImmediate` is enough at personal scale.
- No rate limiting on `/save`. You are the only caller; the shared secret is the rate limit.

## License

MIT.
