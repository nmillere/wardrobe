# Wardrobe Site Rebuild — Design Spec
_2026-05-08_

## Overview

Rebuild the wardrobe tracker to replace rigid work/casual/active categories with a flexible tag system, and eliminate the manual GitHub push/pull flow in favor of automatic server-side writes.

---

## Goals

1. **Tags instead of categories** — items can belong to multiple contexts (e.g. an active item that also works casually gets both `active` and `casual` tags)
2. **Auto-save writes** — edits in the browser save immediately with no push button; the browser never touches the GitHub API
3. **Dynamic gap analysis** — gaps computed from tag coverage, not hardcoded text

---

## Architecture

Three deployable pieces, all on Vercel:

| Layer | File | Role |
|---|---|---|
| Frontend | `index.html` | Single HTML file, served from repo root |
| Write API | `api/wardrobe.ts` | New REST endpoint for browser CRUD |
| MCP server | `api/mcp.ts` | Existing AI tool endpoint, updated for tags |

**Data store:** `wardrobe.csv` in the GitHub repo (`nmillere/wardrobe`), read/written by both API endpoints using the server-side `GITHUB_TOKEN` env var. The browser never holds a GitHub token.

---

## Data Model

### CSV columns (new)

```
id, tags, brand, name, color, hex, palette_score, status, notes
```

Changes from current schema:
- `category` → `tags` (pipe-separated string: `"work|top|casual"`)
- `crossover` → **removed** (an active item that works casually just gets the `casual` tag)

### Tag taxonomy

**Context tags** (when/where worn):
`work`, `casual`, `active`, `lounge`

**Type tags** (what the item is):
`top`, `bottom`, `dress`, `outerwear`, `shoes`, `accessory`

**Custom tags:** any free-form text, user-defined per item.

An item can have any combination: `"active|casual|top"`, `"work|casual|bottom"`, `"active|shoes"`, etc.

### Migration of existing 65 items

| Current | Becomes |
|---|---|
| `category: "work"` | `tags: "work"` |
| `category: "casual"` | `tags: "casual"` |
| `category: "active"`, `crossover: "Yes"` | `tags: "active\|casual"` |
| `category: "active"`, `crossover: "Partial"` | `tags: "active\|casual"` |
| `category: "active"`, `crossover: "No"` | `tags: "active"` |

Type tags are not back-filled on migration — users add them over time via the edit form.

---

## API: `api/wardrobe.ts`

New Vercel serverless function handling all browser CRUD. Uses the same GitHub CSV read/write pattern as `api/mcp.ts`.

| Method | Path | Body / Params | Action |
|---|---|---|---|
| `GET` | `/api/wardrobe` | — | Returns all items as JSON array |
| `POST` | `/api/wardrobe` | `{item without id}` | Appends item, auto-increments ID |
| `PUT` | `/api/wardrobe` | `{item with id}` | Replaces item by ID |
| `DELETE` | `/api/wardrobe?id=X` | — | Removes item by ID |

All mutating methods read the current CSV sha before writing (required by GitHub API). No CORS headers needed — the frontend and API are served from the same Vercel domain (same-origin).

---

## API: `api/mcp.ts` (updated)

**`list_wardrobe_items`**
- Filter param changes from `category: enum["work","casual","active"]` to `tag: string` (optional)
- Returns items where `tags` contains the given tag

**`add_wardrobe_item`**
- `category` param → `tags: string[]` (array of tag strings)
- `crossover` param removed
- Tags serialized as pipe-separated when writing to CSV

---

## Frontend: `index.html`

### Removed
- GitHub settings modal
- Pull from GitHub / Push to GitHub buttons
- `gh-config` localStorage entry
- `da-wardrobe` localStorage entry (items no longer cached locally — source of truth is the API)
- `DEFAULT_ITEMS` seed array (~300 lines of embedded JS)
- Category sections (Work / Casual / Active collapsible sections)
- Crossover column in table
- Hardcoded gap analysis text

### Changed
- **Data source on load:** fetch from `/api/wardrobe` instead of raw GitHub URL
- **Save/edit/delete:** call `POST/PUT/DELETE /api/wardrobe` immediately; update local state on success; show toast on error
- **Filter bar:** tag filter chips (multi-select) replace the old Work/Casual/Active buttons. Active filters are ANDed — selecting `work` + `top` shows items tagged with both.
- **Table layout:** flat list (no sections), sorted by brand alphabetically by default with brand-name subheader rows (same visual grouping as current, minus the category section wrappers). Columns: Item (name + tag chips below), Brand, Color, Palette fit, Notes, Actions.
- **Tag chips on rows:** rendered below the item name, smaller font. Color-coded: context tags warm/olive, type tags blue, custom tags neutral.
- **Add/edit form:** tag field replaces category dropdown + crossover select. Predefined tags shown as clickable chips; custom tag typed into an input and added to the selection.

### Metrics bar
The Crossover metric is replaced with **"Multi-context"** — count of items tagged with 2+ context tags.

### Gap analysis (dynamic)
Computed on render from current items. Logic:

1. For each context tag (`work`, `casual`, `active`, `lounge`): count items with `palette_score >= 8`
2. For each context+type pair with at least 1 item total: count DA-ideal items (score ≥ 8)
3. Flag pairs where DA-ideal count = 0 as **High** priority; count = 1 as **Low** priority
4. Display as a list: _"No DA-ideal work outerwear"_, _"No DA-ideal shoes"_, etc.
5. If no gaps detected: show a "Looking good" empty state

---

## What Stays the Same

- DA color palette, typography (DM Serif Display / DM Sans), and overall visual design
- Palette score 1–10 scale and color coding (red/yellow/green)
- `status` field: `incoming` / `updated` / empty
- Search (searches name, brand, color, notes, tags)
- Sort options (default/score/name/brand)
- Export CSV button
- `incoming` and `updated` row highlights
- Toast notifications
- `wardrobe.csv` as authoritative data source in GitHub
