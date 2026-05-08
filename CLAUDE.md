# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # TypeScript type-check only (tsc --noEmit) — no output emitted locally
```

There are no test commands. Vercel handles TypeScript compilation on deploy.

To develop the frontend, open `index.html` directly in a browser — no build step needed.

## Architecture

This is a wardrobe management app for a Deep Autumn (DA) color palette. It has two independently deployable layers:

**Frontend** (`index.html`): A single ~1300-line HTML file with embedded CSS and JS. It uses `localStorage` as its local data store and syncs to a GitHub-hosted CSV via the GitHub API. To use sync, the user provides a personal access token in the GitHub Settings modal. The 64 default wardrobe items are embedded directly in the JS as a seed array.

**MCP server** (`api/mcp.ts`): A Vercel serverless function (60s max duration) that exposes two MCP tools — `list_wardrobe_items` and `add_wardrobe_item`. It reads/writes `wardrobe.csv` directly in the GitHub repo (`nmillere/wardrobe`) using the GitHub API, authenticated via a `GITHUB_TOKEN` environment variable set in Vercel. The transport is `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`.

**Data store** (`wardrobe.csv`): The authoritative data source. The CSV format is: `id,tags,brand,name,color,hex,palette_score,status,notes`. The `tags` field is pipe-separated (e.g. `"active|casual"`). The frontend and MCP server both read from and write to this file via GitHub's API.

**Deployment**: Vercel serves `public/` as static output and `api/mcp.ts` as a serverless function. The frontend (`index.html`) is served from the repo root, not `public/`.

## Key Details

- Palette scores 1–4 = avoid (red), 5–7 = conditional (yellow), 8–10 = DA ideal (green)
- `status` field: `incoming` = ordered but not received, `updated` = recently re-scored
- The MCP server auto-increments IDs by finding the max existing ID in the CSV
- The frontend's CSV parser (`parseCSVRow`) handles quoted fields with escaped internal quotes — be careful modifying it
- No `README.md` exists in the repo
