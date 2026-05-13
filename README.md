# recall

Personal save-to-Claude corpus. Capture URLs from iOS or Mac, extract and summarize them, expose the corpus as MCP tools so Claude Code can search saved content during normal work.

See `PLAN.md` for the architecture and execution plan.

## packages

- `@recall/shared` - DB, types, env, URL utilities
- `@recall/api` - HTTP capture endpoint (deployed on EC2)
- `@recall/mcp` - MCP server (runs locally on Mac)

## setup

In progress. Phase 1 scaffolding only. Run `pnpm install` after cloning.
