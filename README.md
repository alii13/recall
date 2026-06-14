# recall

![recall banner](assets/banner.png)

[![ci](https://github.com/alii13/recall/actions/workflows/ci.yml/badge.svg)](https://github.com/alii13/recall/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

I share links to myself all day. WhatsApp to self, Notes app, bookmarks I never reopen, browser tabs I close in ten minutes. Two months later I'm building something, vaguely remember reading the perfect thing for it, and can never find it again. This is the tool I built to fix that.

You save a URL. Recall fetches the page, summarizes it, embeds it, files it away. From then on, when you're working with Claude Code on something and ask *"did I save anything about retrieval evals?"* or *"what was that post about long-running agents?"* - Claude searches your corpus and surfaces what's actually relevant. The right card, not 30 bookmarks to skim.

The shift that makes this different from Pocket, Readwise, or an Obsidian vault: **your saves don't go to a human inbox you'll never open again**. They go straight into Claude's context as a tool it can pull from while you're working on something else. Your assistant becomes specifically yours over time - it knows what you've been reading, what you've been investigating, what you cared about three months ago when you skimmed an article and forgot.

If you already use Claude Code every day, this slots into the workflow you have. Capture from iPhone Share Sheet, Mac clipboard, or curl. The pipeline does extraction + summarization in the background; the iOS Shortcut returns in under a second so the share sheet doesn't block. Search happens through MCP, automatically, the moment Claude needs context.

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

    cf["2 - Cloudflare edge<br/>TLS terminated here<br/>routes via tunnel"]

    subgraph host["3 - API host (any small Linux box)"]
        cfd["cloudflared<br/>outbound tunnel<br/>(no inbound ports)"]
        api["Hono /save<br/>auth, dedupe, insert pending<br/>respond < 100 ms"]
        subgraph pipe["4 - async pipeline"]
            extract["extract<br/>Reddit / YouTube / Twitter<br/>Jina for the long tail"]
            sumr["summarize<br/>Qwen on NVIDIA NIM"]
            embed["embed<br/>nv-embedqa-e5-v5"]
        end
    end

    db[("5 - Postgres + pgvector<br/>cards · hnsw · btree")]

    subgraph mac["6 - your Mac"]
        mcp["MCP server (stdio)<br/>search_saved · recent_saves · get_card"]
        cc["Claude Code"]
    end

    user --> capture --> cf --> cfd --> api
    api -.->|pending row| db
    api ==>|card_id| pipe
    extract --> sumr --> embed -.->|status = ok| db
    user --> cc <--> mcp <--> db
```

## Components

- `@recall/shared` - Drizzle schema, URL utilities (normalize / hash / route), env loader, DB client
- `@recall/api` - Hono HTTP server with `/save`, custom extractors for Reddit / YouTube / Twitter, Jina-based generic extractor with OG fallback, the summarize-embed-orchestrate pipeline
- `@recall/mcp` - MCP stdio server: `search_saved`, `recent_saves`, `get_card`, and `search_learnings` (recall over kept session learnings)
- `@recall/capture` - a Claude Code `SessionEnd` + `PreCompact` hook that captures durable learnings from a session transcript into a separate `learnings` table (see [Capture session learnings](#capture-session-learnings))

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

This creates the `cards` table (your saved-URL corpus) with an HNSW index on `embedding` and btree indexes on `created_at` and `source_type`, plus the `learnings` table used by [session capture](#capture-session-learnings). Both carry their own HNSW cosine index; they are never queried together.

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

### Capture session learnings

The save pipeline accumulates what you *read*. This does the same for what you *decide*. `@recall/capture` is a Claude Code hook that runs on both `SessionEnd` and `PreCompact`: when a session ends - or just before its context is compacted - it reads the transcript, asks the same NIM Qwen model to pull out durable decisions, corrections, and gotchas and score each for importance (1-5), embeds them, deduplicates against both the current batch and what is already stored, and **auto-keeps the ones rated `≥ 4`** (the `RECALL_KEEP_THRESHOLD`). There is no human review step - because nothing human reads this store, the importance score plus dedup are the quality gate. Kept learnings surface back into any session through the `search_learnings` MCP tool (see [MCP tools](#mcp-tools)), closing the loop: capture at session end → auto-keep the high-signal ones → recall on demand.

It is deliberately walled off from your saved URLs. The three MCP tools only ever read `cards`, so a captured learning can never surface as if it were something you saved. Only the human-readable dialogue is sent to NIM - tool output, where leaked secrets tend to live, is dropped before extraction.

Build first, then add the hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/opt/homebrew/bin/node /absolute/path/to/recall/packages/capture/dist/hook.js",
            "timeout": 10
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/opt/homebrew/bin/node /absolute/path/to/recall/packages/capture/dist/hook.js",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

`SessionEnd` and `PreCompact` hooks both have a tight budget and cannot block, so the hook only launches a detached background worker and exits immediately; the worker does the slow NIM + embed + insert with no timeout pressure. Capturing on `PreCompact` matters because compaction replaces older turns with a summary - running just before it preserves decisions that would otherwise be summarised away. The same transcript can be read on compaction and again at session end, but the cross-run dedup keeps that from piling up duplicates. It is best-effort by design - if the worker is killed before it finishes, those learnings are lost.

Every run appends one JSON line to `~/.recall/capture.log` (override with `RECALL_CAPTURE_LOG`). That is how you tell it is working, or failing:

```bash
tail -f ~/.recall/capture.log
# {"ts":"...","status":"launch","sessionId":"...","pid":12345}
# {"ts":"...","status":"ok","sessionId":"...","project":"recall","inserted":3,"droppedLowImportance":4,"deduped":1,"durationMs":61079}
```

A `launch` line with no matching `ok` / `empty` / `error` for the same `sessionId` means the worker died silently. Grep `"status":"error"` to see failures and their messages (e.g. `nim_chat_failed` when the model times out).

High-importance learnings are kept automatically, so the loop runs without you in it. The review CLI is still there for optional cleanup - inspecting what was kept and pruning anything that slipped through:

```bash
node packages/capture/dist/review.js list            # all learnings + status/importance (optionally: list <project>)
node packages/capture/dist/review.js skip <id> <id>  # delete one that slipped through
```

Because nothing human reads the store, a retrieval eval is the only signal that recall still works - it seeds known fixtures, runs them through `search_learnings`, and reports precision:

```bash
pnpm --filter @recall/mcp build && pnpm --filter @recall/mcp eval
# { "n": 6, "precision@1": 1, "recall@3": 1, "misses": [] }
```

### Scheduled cleanup

Nothing prunes the store by hand, so a deterministic sweep removes near-duplicates and stale rows. It deletes at most `RECALL_SWEEP_MAX_DELETE` (default 25) per run, never touches importance-5 rows, and logs every removal (id, title, reason) to `~/.recall/capture.log`:

```bash
node packages/capture/dist/sweep.js
# duplicates: cosine >= 0.93, keeps the higher-importance row
# stale:      never surfaced + older than 120 days + importance <= 4
```

To run it weekly on macOS, install a launch agent at `~/Library/LaunchAgents/com.recall.learnings-sweep.plist` that runs the built `sweep.js`, then `launchctl load -w` it:

```xml
<key>ProgramArguments</key>
<array>
  <string>/opt/homebrew/bin/node</string>
  <string>/absolute/path/to/recall/packages/capture/dist/sweep.js</string>
</array>
<key>StartCalendarInterval</key>
<dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>9</integer></dict>
```

### Capture Shortcuts

Two Shortcuts cover the everyday capture surfaces. Install either or both depending on how you save links.

#### 1. Recall - iphone (Share Sheet, iOS + iPad + Mac Safari)

Use when an app gives you a share button (Safari, iOS Chrome, X, Reddit, LinkedIn, YouTube, etc.).

**Quick install:** tap this iCloud link on iPhone, iPad, or Mac:

[**Recall - iphone (template)**](https://www.icloud.com/shortcuts/5d6930d1d04d407f954036ebb7d37e1f)

After import:

1. Open the Shortcut in the Shortcuts app
2. In the **Get Contents of URL** action, replace `https://YOUR-HOST/save` with `https://<your-recall-host>/save`
3. In the same action's **Headers**, replace `YOUR-SAVE-TOKEN` with your `SAVE_TOKEN` value from `.env`
4. In the **(i)** details, enable **Show in Share Sheet** and tick at least **URLs**, **Safari webpages**, **Articles**, and **Rich text** for broad app compatibility (LinkedIn shares as `Articles`, Mail shares as `Rich text`, most browsers as `URLs`)

Test by sharing a tweet or article from Safari. The Shortcut returns in under a second; processing happens async on the server.

**If sharing from a specific app doesn't show Recall - iphone**, that app has filtered out Shortcuts from its share sheet by default. Inside the app's share sheet, scroll to the bottom and tap `Edit Actions...`, then tap the `+` next to Recall - iphone to pin it. One-time per app.

##### Manual build (if you'd rather author from scratch)

1. Open Shortcuts on iOS or macOS, create a new Shortcut named `Recall - iphone`.
2. **Receive** action: accept input from Share Sheet with types URLs, Safari webpages, Articles, Rich text.
3. **Get Item from List** action: input = Shortcut Input, get = First Item. (Some apps send multiple URL items; this picks one cleanly.)
4. **Get Contents of URL** action:
   - URL: `https://<your-recall-host>/save`
   - Method: `POST`
   - Headers: `X-Save-Token: <your-SAVE_TOKEN>` and `Content-Type: application/json`
   - Request Body: **JSON**, with one field `url` whose value is the **Item from List** magic variable (output of step 3).
5. In the Shortcut **(i)** details, enable **Show in Share Sheet** and select the accepted types from step 2.

#### 2. Recall - mac (Mac menu bar)

Use on Mac when an app doesn't surface the macOS share sheet cleanly (Chrome, VS Code, Slack, Discord, Notion, ...). Copy the URL, click the Shortcut from the menu bar.

**Quick install:** tap this iCloud link on Mac:

[**Recall - mac (template)**](https://www.icloud.com/shortcuts/2118ee87d668422a803b57a82a2c0e9b)

After import:

1. Open the Shortcut in Shortcuts.app
2. Replace `YOUR-HOST` and `YOUR-SAVE-TOKEN` in the **Get Contents of URL** action, same as the Share Sheet one
3. In the **(i)** details, enable **Pin in Menu Bar** so it sits in your top-right system menu
4. (Optional) **Add Keyboard Shortcut** like `⌘⌥S` for one-keypress capture from anywhere

**Daily use:** in any Mac app with a URL, `⌘L` (focus address bar / select URL) → `⌘C` → click the menu bar Shortcuts icon → **Recall - mac**. Card is in your corpus before you switch back.

##### Manual build

1. Create new Shortcut named `Recall - mac`.
2. **Get Clipboard** action (no parameters).
3. **Get Contents of URL** action, configured exactly like the Share Sheet version, except the `url` field's JSON body value is the **Clipboard** magic variable from step 2.

## MCP tools

Available in any Claude Code session after wiring:

- **`search_saved(query, limit?, since_days?)`** - semantic search over the embedding column. Returns ranked cards with title, URL, summary, why_useful, tags, score (cosine similarity).
- **`recent_saves(days?, source_type?, limit?)`** - chronological listing. Defaults to last 7 days, top 10. Filter by source_type (`reddit`, `youtube`, `twitter`, `github`, `hackernews`, `article`).
- **`get_card(id)`** - fetch one card with its full markdown body. Use after `search_saved` when you need the actual article text, not just the summary.
- **`search_learnings(query, project?, kind?, limit?)`** - semantic search over your reviewed (`kept`) session learnings. Returns ranked decisions, corrections, and gotchas with title, body, why, how-to-apply, project, tags, and score. Pending (unreviewed) learnings are never returned. See [Capture session learnings](#capture-session-learnings).

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

[MIT](LICENSE) - copyright (c) 2026 Shekh.
