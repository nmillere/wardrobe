import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { fetchCSV, pushCSV, type WardrobeItem } from "./_csv.js";

function createServer(): McpServer {
  const server = new McpServer({ name: "wardrobe", version: "2.0.0" });

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
      hex: z.string().default("#888888").describe("Hex color code e.g. #C4956A"),
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
      const newItem: WardrobeItem = {
        id: nextId,
        tags: tags.join("|"),
        brand,
        name,
        color,
        hex,
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
