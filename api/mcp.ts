import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { fetchCSV, pushCSV, type WardrobeItem } from "./_csv.js";
import { fetchOutfits, pushOutfits, type OutfitEntry } from "./_outfits.js";

function splitColorHex(color: string, hex: string): { color: string; hex: string } {
  const match = color.match(/(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})\b/);
  if (match) {
    const extracted = match[1]!;
    const cleaned = color.replace(extracted, "").trim().replace(/\s{2,}/g, " ");
    return { color: cleaned, hex: hex === "#888888" ? extracted : hex };
  }
  return { color, hex };
}

function createServer(): McpServer {
  const server = new McpServer({ name: "wardrobe", version: "2.0.0" });

  function formatOutfit(o: OutfitEntry, wardrobeItems: WardrobeItem[]): string {
    const resolvedItems = o.item_ids.map((id) => {
      const item = wardrobeItems.find((i) => i.id === id);
      return item
        ? `[${id}] ${item.brand} ${item.name} (${item.color}, score: ${item.score}/10)`
        : `[${id}] unknown`;
    }).join(", ");
    return [
      `[${o.id}] ${o.date} | rating: ${o.rating}/10${o.tags.length ? ` | tags: ${o.tags.join(", ")}` : ""}`,
      `  Items: ${resolvedItems}`,
      ...(o.notes ? [`  Notes: ${o.notes}`] : []),
    ].join("\n");
  }

  server.tool(
    "list_wardrobe_items",
    "List wardrobe items, optionally filtered by a single tag. Context tags: work, casual, active, lounge. Type tags: top, bottom, dress, outerwear, shoes, accessory.",
    { tag: z.string().optional().describe("Filter to items whose tags include this value, e.g. 'work' or 'top'") },
    async ({ tag }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const { items } = await fetchCSV(token);
      const filtered = tag
        ? items.filter((i) => i.tags.split("|").includes(tag))
        : items;
      const text = filtered
        .map(
          (i) =>
            `[${i.id}] ${i.brand} ${i.name} | tags: ${i.tags} | ${i.color} | score: ${i.score}/10${i.status ? ` | ${i.status}` : ""}${i.notes ? `\n    ${i.notes}` : ""}`
        )
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${filtered.length} items${tag ? ` (tag: ${tag})` : ""}:\n\n${text}`,
          },
        ],
      };
    }
  );

  server.tool(
    "add_wardrobe_item",
    "Add a new clothing item to the wardrobe. Palette score: 9-10=core DA colors (rust/burnt orange/dark olive/burgundy/camel), 8=good DA (muted olive/washed black/warm ivory), 7=conditional (black/sandy white/warm grey), 5-6=borderline, 3-4=off-palette, 1-2=avoid.",
    {
      name: z.string().describe("Item name"),
      brand: z.string().describe("Brand or retailer"),
      tags: z
        .array(z.string())
        .describe(
          "Tags for this item. Context: work/casual/active/lounge. Type: top/bottom/dress/outerwear/shoes/accessory. An item worn for both active and casual use gets both tags: ['active','casual']. Custom tags are also allowed."
        ),
      color: z.string().describe("Human-readable color description"),
      hex: z.string().default("#888888").describe("Hex color code e.g. #C4956A — always provide a specific value matching the color; do not leave as #888888"),
      palette_score: z
        .number()
        .int()
        .min(1)
        .max(10)
        .describe("Deep Autumn palette compatibility score 1-10"),
      status: z
        .enum(["", "incoming", "updated"])
        .default("")
        .describe("Leave empty if owned; use 'incoming' if ordered but not arrived"),
      notes: z.string().default("").describe("Styling tips, pairing advice, DA context"),
    },
    async ({ name, brand, tags, color, hex, palette_score, status, notes }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const { items, sha } = await fetchCSV(token);
      const nextId = items.length ? Math.max(...items.map((i) => i.id)) + 1 : 1;
      const { color: cleanColor, hex: cleanHex } = splitColorHex(color, hex);
      const newItem: WardrobeItem = {
        id: nextId,
        tags: tags.join("|"),
        brand,
        name,
        color: cleanColor,
        hex: cleanHex,
        score: palette_score,
        status,
        notes,
      };
      items.push(newItem);
      await pushCSV(token, items, sha, `Add ${name} to wardrobe via MCP`);
      return {
        content: [
          {
            type: "text",
            text: `Added: [${nextId}] ${brand} ${name} | tags: ${newItem.tags} | ${color} | score: ${palette_score}/10${status ? ` | ${status}` : ""}`,
          },
        ],
      };
    }
  );

  server.tool(
    "batch_add_wardrobe_items",
    "Add multiple clothing items to the wardrobe in a single operation. Palette score: 9-10=core DA colors (rust/burnt orange/dark olive/burgundy/camel), 8=good DA (muted olive/washed black/warm ivory), 7=conditional (black/sandy white/warm grey), 5-6=borderline, 3-4=off-palette, 1-2=avoid.",
    {
      items: z
        .array(
          z.object({
            name: z.string().describe("Item name"),
            brand: z.string().describe("Brand or retailer"),
            tags: z
              .array(z.string())
              .describe(
                "Context: work/casual/active/lounge. Type: top/bottom/dress/outerwear/shoes/accessory."
              ),
            color: z.string().describe("Human-readable color description e.g. 'Rust Brown'"),
            hex: z
              .string()
              .default("#888888")
              .describe(
                "Hex color code e.g. #C4956A — always provide a specific value matching the color; do not leave as #888888"
              ),
            palette_score: z
              .number()
              .int()
              .min(1)
              .max(10)
              .describe("Deep Autumn palette compatibility score 1-10"),
            status: z
              .enum(["", "incoming", "updated"])
              .default("")
              .describe("Leave empty if owned; 'incoming' if ordered but not arrived"),
            notes: z.string().default("").describe("Styling tips, pairing advice, DA context"),
          })
        )
        .describe("Array of items to add"),
    },
    async ({ items: newItems }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      if (newItems.length === 0) {
        return { content: [{ type: "text", text: "Nothing to add." }] };
      }
      const { items, sha } = await fetchCSV(token);
      let nextId = items.length ? Math.max(...items.map((i) => i.id)) + 1 : 1;

      const added: WardrobeItem[] = [];
      const skipped: string[] = [];

      for (const newItem of newItems) {
        const tags = newItem.tags.map((t) => t.trim()).filter(Boolean);
        const missingFields = [
          !newItem.name && "name",
          !newItem.brand && "brand",
          !tags.length && "tags",
          !newItem.palette_score && "palette_score",
        ].filter(Boolean) as string[];

        if (missingFields.length > 0) {
          skipped.push(
            `"${newItem.name || "(unnamed)"}" — missing required field: ${missingFields.join(", ")}`
          );
          continue;
        }

        const { color: cleanColor, hex: cleanHex } = splitColorHex(newItem.color, newItem.hex);
        const item: WardrobeItem = {
          id: nextId++,
          tags: tags.join("|"),
          brand: newItem.brand,
          name: newItem.name,
          color: cleanColor,
          hex: cleanHex,
          score: newItem.palette_score,
          status: newItem.status,
          notes: newItem.notes,
        };
        items.push(item);
        added.push(item);
      }

      if (added.length > 0) {
        await pushCSV(
          token,
          items,
          sha,
          `Add ${added.length} item${added.length === 1 ? "" : "s"} to wardrobe via MCP`
        );
      }

      const lines: string[] = [];
      if (added.length > 0) {
        lines.push(`Added ${added.length} item${added.length === 1 ? "" : "s"}:`);
        added.forEach((i) =>
          lines.push(
            `  [${i.id}] ${i.brand} ${i.name} | tags: ${i.tags} | ${i.color} | score: ${i.score}/10`
          )
        );
      }
      if (skipped.length > 0) {
        lines.push(`Skipped ${skipped.length}:`);
        skipped.forEach((s) => lines.push(`  ${s}`));
      }

      return { content: [{ type: "text", text: lines.join("\n") || "Nothing to add." }] };
    }
  );

  server.tool(
    "batch_update_wardrobe_items",
    "Update multiple wardrobe items in a single operation. Supply only the fields you want to change per item; omit the rest. Palette score: 9-10=core DA, 8=good DA, 7=conditional, 5-6=borderline, 3-4=off-palette, 1-2=avoid.",
    {
      updates: z
        .array(
          z.object({
            id: z.number().int().describe("ID of the item to update"),
            name: z.string().optional().describe("Item name"),
            brand: z.string().optional().describe("Brand or retailer"),
            tags: z
              .array(z.string())
              .optional()
              .describe(
                "Context: work/casual/active/lounge. Type: top/bottom/dress/outerwear/shoes/accessory."
              ),
            color: z
              .string()
              .optional()
              .describe("Human-readable color description e.g. 'Rust Brown'"),
            hex: z
              .string()
              .optional()
              .describe(
                "Hex color code e.g. #C4956A — always provide a specific value; do not use #888888"
              ),
            palette_score: z
              .number()
              .int()
              .min(1)
              .max(10)
              .optional()
              .describe("Deep Autumn palette compatibility score 1-10"),
            status: z
              .enum(["", "incoming", "updated"])
              .optional()
              .describe(
                "Leave empty if owned; 'incoming' if ordered but not arrived; 'updated' if recently re-scored"
              ),
            notes: z.string().optional().describe("Styling tips, pairing advice, DA context"),
          })
        )
        .describe("Array of updates, each with an id and the fields to change"),
    },
    async ({ updates }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");

      if (updates.length === 0) {
        return { content: [{ type: "text", text: "Nothing to update." }] };
      }

      const { items, sha } = await fetchCSV(token);

      const updatedIds: number[] = [];
      const skipped: string[] = [];

      for (const update of updates) {
        const idx = items.findIndex((i) => i.id === update.id);
        if (idx === -1) {
          skipped.push(`ID ${update.id} — not found`);
          continue;
        }
        const existing = items[idx]!;
        const { color: cleanColor, hex: cleanHex } =
          update.color !== undefined
            ? splitColorHex(update.color, update.hex ?? existing.hex)
            : { color: existing.color, hex: update.hex ?? existing.hex };

        items[idx] = {
          ...existing,
          ...(update.name !== undefined && { name: update.name }),
          ...(update.brand !== undefined && { brand: update.brand }),
          ...(update.tags !== undefined && {
            tags: update.tags
              .map((t) => t.trim())
              .filter(Boolean)
              .join("|"),
          }),
          ...(update.color !== undefined && { color: cleanColor }),
          ...((update.color !== undefined || update.hex !== undefined) && { hex: cleanHex }),
          ...(update.palette_score !== undefined && { score: update.palette_score }),
          ...(update.status !== undefined && { status: update.status }),
          ...(update.notes !== undefined && { notes: update.notes }),
        };
        updatedIds.push(update.id);
      }

      if (updatedIds.length > 0) {
        await pushCSV(
          token,
          items,
          sha,
          `Update ${updatedIds.length} item${updatedIds.length === 1 ? "" : "s"} in wardrobe via MCP`
        );
      }

      const lines: string[] = [];
      if (updatedIds.length > 0) {
        lines.push(
          `Updated ${updatedIds.length} item${updatedIds.length === 1 ? "" : "s"}: ${updatedIds.map((id) => `[${id}]`).join(", ")}`
        );
      }
      if (skipped.length > 0) {
        lines.push(`Skipped ${skipped.length}:`);
        skipped.forEach((s) => lines.push(`  ${s}`));
      }

      return { content: [{ type: "text", text: lines.join("\n") || "Nothing to update." }] };
    }
  );

  server.tool(
    "batch_delete_wardrobe_items",
    "Permanently remove multiple wardrobe items by ID in a single operation.",
    {
      ids: z.array(z.number().int()).describe("Array of item IDs to delete"),
    },
    async ({ ids }) => {
      if (ids.length === 0) {
        return { content: [{ type: "text", text: "Nothing to delete." }] };
      }
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const { items, sha } = await fetchCSV(token);

      const deleted: WardrobeItem[] = [];
      const skipped: string[] = [];

      for (const id of ids) {
        const item = items.find((i) => i.id === id);
        if (!item) {
          skipped.push(`ID ${id} — not found`);
          continue;
        }
        deleted.push(item);
      }

      if (deleted.length > 0) {
        const deletedIds = new Set(deleted.map((i) => i.id));
        await pushCSV(
          token,
          items.filter((i) => !deletedIds.has(i.id)),
          sha,
          `Delete ${deleted.length} item${deleted.length === 1 ? "" : "s"} from wardrobe via MCP`
        );
      }

      const lines: string[] = [];
      if (deleted.length > 0) {
        lines.push(`Deleted ${deleted.length} item${deleted.length === 1 ? "" : "s"}:`);
        deleted.forEach((i) => lines.push(`  [${i.id}] ${i.brand} ${i.name}`));
      }
      if (skipped.length > 0) {
        lines.push(`Skipped ${skipped.length}:`);
        skipped.forEach((s) => lines.push(`  ${s}`));
      }

      return { content: [{ type: "text", text: lines.join("\n") || "Nothing to delete." }] };
    }
  );

  server.tool(
    "search_wardrobe_items",
    "Search wardrobe items using any combination of free-text query and structured filters. All specified filters must match (AND logic).",
    {
      query: z.string().optional().describe("Case-insensitive text search across name, brand, color, and notes"),
      tags: z.array(z.string()).optional().describe("Item must have ALL of these tags"),
      min_score: z.number().int().min(1).max(10).optional().describe("Minimum palette score (inclusive)"),
      max_score: z.number().int().min(1).max(10).optional().describe("Maximum palette score (inclusive)"),
      status: z.enum(["", "incoming", "updated"]).optional().describe("Filter by status"),
    },
    async ({ query, tags, min_score, max_score, status }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const { items } = await fetchCSV(token);
      const q = query?.toLowerCase();
      const filtered = items.filter((i) => {
        if (q && ![i.name, i.brand, i.color, i.notes].some((v) => v.toLowerCase().includes(q))) return false;
        if (tags && !tags.every((t) => i.tags.split("|").includes(t))) return false;
        if (min_score !== undefined && i.score < min_score) return false;
        if (max_score !== undefined && i.score > max_score) return false;
        if (status !== undefined && i.status !== status) return false;
        return true;
      });
      const text = filtered
        .map((i) => `[${i.id}] ${i.brand} ${i.name} | tags: ${i.tags} | ${i.color} | score: ${i.score}/10${i.status ? ` | ${i.status}` : ""}${i.notes ? `\n    ${i.notes}` : ""}`)
        .join("\n");
      return {
        content: [{ type: "text", text: `${filtered.length} result(s):\n\n${text || "(none)"}` }],
      };
    }
  );

  server.tool(
    "get_wardrobe_item",
    "Get a single wardrobe item by its numeric ID.",
    { id: z.number().int().describe("Item ID") },
    async ({ id }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const { items } = await fetchCSV(token);
      const item = items.find((i) => i.id === id);
      if (!item) throw new Error(`Item ${id} not found`);
      return {
        content: [
          {
            type: "text",
            text: `[${item.id}] ${item.brand} ${item.name} | tags: ${item.tags} | ${item.color} (${item.hex}) | score: ${item.score}/10${item.status ? ` | ${item.status}` : ""}${item.notes ? `\n    ${item.notes}` : ""}`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_wardrobe_item",
    "Update any fields of an existing wardrobe item by ID. Only supply fields you want to change; omit the rest. Palette score: 9-10=core DA, 8=good DA, 7=conditional, 5-6=borderline, 3-4=off-palette, 1-2=avoid.",
    {
      id: z.number().int().describe("ID of the item to update"),
      name: z.string().optional().describe("Item name"),
      brand: z.string().optional().describe("Brand or retailer"),
      tags: z.array(z.string()).optional().describe("Context: work/casual/active/lounge. Type: top/bottom/dress/outerwear/shoes/accessory."),
      color: z.string().optional().describe("Human-readable color description"),
      hex: z.string().optional().describe("Hex color code e.g. #C4956A"),
      palette_score: z.number().int().min(1).max(10).optional().describe("Deep Autumn palette compatibility score 1-10"),
      status: z.enum(["", "incoming", "updated"]).optional().describe("Leave empty if owned; 'incoming' if ordered but not arrived; 'updated' if recently re-scored"),
      notes: z.string().optional().describe("Styling tips, pairing advice, DA context"),
    },
    async ({ id, name, brand, tags, color, hex, palette_score, status, notes }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const { items, sha } = await fetchCSV(token);
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) throw new Error(`Item ${id} not found`);
      const existing = items[idx]!;
      const { color: cleanColor, hex: cleanHex } = color !== undefined
        ? splitColorHex(color, hex ?? existing.hex)
        : { color: existing.color, hex: hex ?? existing.hex };
      const updated: WardrobeItem = {
        ...existing,
        ...(name !== undefined && { name }),
        ...(brand !== undefined && { brand }),
        ...(tags !== undefined && { tags: tags.join("|") }),
        ...(color !== undefined && { color: cleanColor }),
        ...(color !== undefined || hex !== undefined) && { hex: cleanHex },
        ...(palette_score !== undefined && { score: palette_score }),
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes }),
      };
      items[idx] = updated;
      await pushCSV(token, items, sha, `Update ${updated.name} in wardrobe via MCP`);
      return {
        content: [
          {
            type: "text",
            text: `Updated: [${updated.id}] ${updated.brand} ${updated.name} | tags: ${updated.tags} | ${updated.color} | score: ${updated.score}/10${updated.status ? ` | ${updated.status}` : ""}${updated.notes ? `\n    ${updated.notes}` : ""}`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_wardrobe_item",
    "Permanently remove a wardrobe item by ID.",
    { id: z.number().int().describe("ID of the item to delete") },
    async ({ id }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const { items, sha } = await fetchCSV(token);
      const item = items.find((i) => i.id === id);
      if (!item) throw new Error(`Item ${id} not found`);
      await pushCSV(token, items.filter((i) => i.id !== id), sha, `Remove ${item.name} from wardrobe via MCP`);
      return {
        content: [{ type: "text", text: `Deleted: [${id}] ${item.brand} ${item.name}` }],
      };
    }
  );

  server.tool(
    "log_outfit",
    "Log an outfit you wore. All item_ids must exist in the wardrobe — use list_wardrobe_items to find IDs first.",
    {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date worn (YYYY-MM-DD)"),
      item_ids: z.array(z.number().int()).min(1).describe("IDs of wardrobe items worn"),
      rating: z.number().int().min(1).max(10).describe("How well the outfit worked (1–10)"),
      tags: z.array(z.string()).default([]).describe("Context/descriptive tags e.g. ['work', 'spring']"),
      notes: z.string().default("").describe("Reflections on the outfit"),
    },
    async ({ date, item_ids, rating, tags, notes }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const { items } = await fetchCSV(token);
      const missing = item_ids.filter((id) => !items.find((i) => i.id === id));
      if (missing.length) throw new Error(`Item IDs not found in wardrobe: ${missing.join(", ")}`);
      const { outfits, sha } = await fetchOutfits(token);
      const nextId = outfits.length ? Math.max(...outfits.map((o) => o.id)) + 1 : 1;
      const newOutfit: OutfitEntry = { id: nextId, date, item_ids, rating, notes, tags };
      await pushOutfits(token, [...outfits, newOutfit], sha, `Log outfit ${date} via MCP`);
      const itemNames = item_ids
        .map((id) => {
          const item = items.find((i) => i.id === id)!;
          return `${item.brand} ${item.name}`;
        })
        .join(", ");
      return {
        content: [{
          type: "text",
          text: `Logged outfit [${nextId}] on ${date}: ${itemNames} | rating: ${rating}/10${tags.length ? ` | tags: ${tags.join(", ")}` : ""}${notes ? `\n  ${notes}` : ""}`,
        }],
      };
    }
  );

  server.tool(
    "list_outfits",
    "List recent outfit log entries with wardrobe item details resolved inline. Use this to brainstorm new outfits based on what has worked before.",
    {
      limit: z.number().int().min(1).max(100).default(20).describe("Max entries to return, newest first"),
    },
    async ({ limit }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const [{ outfits }, { items }] = await Promise.all([fetchOutfits(token), fetchCSV(token)]);
      const sorted = [...outfits].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
      if (!sorted.length) return { content: [{ type: "text", text: "No outfits logged yet." }] };
      const text = sorted.map((o) => formatOutfit(o, items)).join("\n\n");
      return { content: [{ type: "text", text: `${sorted.length} outfit(s):\n\n${text}` }] };
    }
  );

  server.tool(
    "search_outfits",
    "Filter outfit log entries by tags, item IDs, date range, or rating. Returns matching outfits with item details resolved inline.",
    {
      tags: z.array(z.string()).optional().describe("Outfit must include ALL of these tags"),
      item_ids: z.array(z.number().int()).optional().describe("Outfit must contain at least ONE of these item IDs"),
      date_from: z.string().optional().describe("Start date inclusive (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date inclusive (YYYY-MM-DD)"),
      min_rating: z.number().int().min(1).max(10).optional().describe("Minimum rating inclusive"),
      max_rating: z.number().int().min(1).max(10).optional().describe("Maximum rating inclusive"),
    },
    async ({ tags, item_ids, date_from, date_to, min_rating, max_rating }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const [{ outfits }, { items }] = await Promise.all([fetchOutfits(token), fetchCSV(token)]);
      const filtered = outfits
        .filter((o) => {
          if (tags && !tags.every((t) => o.tags.includes(t))) return false;
          if (item_ids && !item_ids.some((id) => o.item_ids.includes(id))) return false;
          if (date_from && o.date < date_from) return false;
          if (date_to && o.date > date_to) return false;
          if (min_rating !== undefined && o.rating < min_rating) return false;
          if (max_rating !== undefined && o.rating > max_rating) return false;
          return true;
        })
        .sort((a, b) => b.date.localeCompare(a.date));
      if (!filtered.length) return { content: [{ type: "text", text: "No matching outfits." }] };
      const text = filtered.map((o) => formatOutfit(o, items)).join("\n\n");
      return { content: [{ type: "text", text: `${filtered.length} result(s):\n\n${text}` }] };
    }
  );

  server.tool(
    "get_outfit",
    "Fetch a single outfit entry by ID with full wardrobe item details resolved.",
    { id: z.number().int().describe("Outfit ID") },
    async ({ id }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const [{ outfits }, { items }] = await Promise.all([fetchOutfits(token), fetchCSV(token)]);
      const outfit = outfits.find((o) => o.id === id);
      if (!outfit) throw new Error(`Outfit ${id} not found`);
      const resolvedItems = outfit.item_ids
        .map((itemId) => {
          const item = items.find((i) => i.id === itemId);
          if (!item) return `[${itemId}] unknown`;
          return `[${itemId}] ${item.brand} ${item.name} | ${item.color} (${item.hex}) | score: ${item.score}/10 | tags: ${item.tags}${item.notes ? `\n      ${item.notes}` : ""}`;
        })
        .join("\n  ");
      return {
        content: [{
          type: "text",
          text: [
            `[${outfit.id}] ${outfit.date} | rating: ${outfit.rating}/10${outfit.tags.length ? ` | tags: ${outfit.tags.join(", ")}` : ""}`,
            `  Items:\n  ${resolvedItems}`,
            ...(outfit.notes ? [`  Notes: ${outfit.notes}`] : []),
          ].join("\n"),
        }],
      };
    }
  );

  return server;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method === "GET") {
    res.status(200).json({ name: "wardrobe-mcp", version: "2.0.0" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
