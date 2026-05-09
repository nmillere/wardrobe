# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # TypeScript type-check only (tsc --noEmit) — no output emitted locally
```

There are no test commands. Vercel handles TypeScript compilation on deploy.

To develop the frontend, open `public/index.html` directly in a browser — no build step needed.

## Architecture

This is a wardrobe management app for a Deep Autumn (DA) color palette. It has two independently deployable layers:

**Frontend** (`public/`): Three files — `index.html`, `style.css`, and `app.js`. It uses `localStorage` as its local data store and syncs to a GitHub-hosted CSV via the GitHub API. To use sync, the user provides a personal access token in the GitHub Settings modal. The 64 default wardrobe items are embedded directly in the JS as a seed array.

**MCP server** (`api/mcp.ts`): A Vercel serverless function (60s max duration) that exposes nine MCP tools: `list_wardrobe_items`, `add_wardrobe_item`, `search_wardrobe_items`, `get_wardrobe_item`, `update_wardrobe_item`, `delete_wardrobe_item`, `batch_add_wardrobe_items`, `batch_update_wardrobe_items`, `batch_delete_wardrobe_items`. It reads/writes `wardrobe.csv` directly in the GitHub repo (`nmillere/wardrobe`) using the GitHub API, authenticated via a `GITHUB_TOKEN` environment variable set in Vercel. The transport is `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`.

**Data store** (`wardrobe.csv`): The authoritative data source. The CSV format is: `id,tags,brand,name,color,hex,palette_score,status,notes`. The `tags` field is pipe-separated (e.g. `"active|casual"`). The frontend and MCP server both read from and write to this file via GitHub's API.

**Deployment**: Vercel serves `public/` as static output and `api/mcp.ts` as a serverless function. The frontend is served from `public/`: `index.html`, `style.css`, and `app.js`.

## Key Details

- Palette scores 1–4 = avoid (red), 5–7 = conditional (yellow), 8–10 = DA ideal (green)
- `status` field: `incoming` = ordered but not received, `updated` = recently re-scored
- The MCP server auto-increments IDs by finding the max existing ID in the CSV
- The frontend's CSV parser (`parseCSVRow`) handles quoted fields with escaped internal quotes — be careful modifying it
- No `README.md` exists in the repo
