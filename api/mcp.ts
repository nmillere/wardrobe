import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const OWNER = "nmillere";
const REPO = "wardrobe";
const FILE = "wardrobe.csv";
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

interface WardrobeItem {
  id: number;
  cat: string;
  brand: string;
  name: string;
  color: string;
  hex: string;
  score: number;
  cross: string;
  status: string;
  notes: string;
}

function parseCSV(csv: string): WardrobeItem[] {
  const lines = csv.trim().split("\n");
  // skip header
  return lines.slice(1).map((line) => {
    const cols = parseCSVRow(line);
    return {
      id: parseInt(cols[0] ?? "0", 10),
      cat: cols[1] ?? "",
      brand: cols[2] ?? "",
      name: cols[3] ?? "",
      color: cols[4] ?? "",
      hex: cols[5] ?? "",
      score: parseInt(cols[6] ?? "5", 10),
      cross: cols[7] ?? "No",
      status: cols[8] ?? "",
      notes: cols[9] ?? "",
    };
  }).filter((i) => i.id > 0);
}

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let val = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          val += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          val += line[i++];
        }
      }
      result.push(val);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) {
        result.push(line.slice(i));
        break;
      }
      result.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return result;
}

function buildCSV(items: WardrobeItem[]): string {
  const header = "id,category,brand,name,color,hex,palette_score,crossover,status,notes";
  const rows = items.map((i) =>
    [i.id, i.cat, i.brand, i.name, i.color, i.hex, i.score, i.cross, i.status, i.notes]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...rows].join("\n");
}

async function fetchCSV(token: string): Promise<{ items: WardrobeItem[]; sha: string }> {
  const res = await fetch(API_BASE, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content: string; sha: string };
  const csv = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
  return { items: parseCSV(csv), sha: data.sha };
}

async function pushCSV(token: string, items: WardrobeItem[], sha: string, message: string): Promise<void> {
  const csv = buildCSV(items);
  const content = Buffer.from(csv, "utf-8").toString("base64");
  const res = await fetch(API_BASE, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github.v3+json",
    },
    body: JSON.stringify({ message, content, sha }),
  });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
}

function createServer(): McpServer {
  const server = new McpServer({ name: "wardrobe", version: "1.0.0" });

  server.tool(
    "list_wardrobe_items",
    "List current wardrobe items, optionally filtered by category",
    { category: z.enum(["work", "casual", "active"]).optional() },
    async ({ category }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const { items } = await fetchCSV(token);
      const filtered = category ? items.filter((i) => i.cat === category) : items;
      const text = filtered
        .map(
          (i) =>
            `[${i.id}] ${i.brand} ${i.name} | ${i.cat} | ${i.color} | score: ${i.score}/10 | crossover: ${i.cross}${i.status ? ` | ${i.status}` : ""}${i.notes ? `\n    ${i.notes}` : ""}`
        )
        .join("\n");
      return {
        content: [{ type: "text", text: `${filtered.length} items${category ? ` (${category})` : ""}:\n\n${text}` }],
      };
    }
  );

  server.tool(
    "add_wardrobe_item",
    "Add a new clothing item to the wardrobe. Palette score: 9-10=core DA colors (rust/burnt orange/dark olive/burgundy/camel), 8=good DA (muted olive/washed black/warm ivory), 7=conditional (black/sandy white/warm grey), 5-6=borderline, 3-4=off-palette (blue denim/cool tones), 1-2=avoid.",
    {
      name: z.string().describe("Item name"),
      brand: z.string().describe("Brand or retailer"),
      category: z.enum(["work", "casual", "active"]).describe("Wardrobe category"),
      color: z.string().describe("Human-readable color description"),
      hex: z.string().default("#888888").describe("Hex color code e.g. #C4956A"),
      palette_score: z.number().int().min(1).max(10).describe("Deep Autumn palette compatibility score 1-10"),
      crossover: z.enum(["Yes", "Partial", "No"]).describe("For active items: can it be worn casually?"),
      status: z.enum(["", "incoming", "updated"]).default("").describe("Leave empty if owned; use 'incoming' if ordered but not arrived"),
      notes: z.string().default("").describe("Styling tips, pairing advice, DA context"),
    },
    async ({ name, brand, category, color, hex, palette_score, crossover, status, notes }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN env var not set");
      const { items, sha } = await fetchCSV(token);
      const nextId = Math.max(...items.map((i) => i.id)) + 1;
      const newItem: WardrobeItem = {
        id: nextId,
        cat: category,
        brand,
        name,
        color,
        hex,
        score: palette_score,
        cross: crossover,
        status,
        notes,
      };
      items.push(newItem);
      await pushCSV(token, items, sha, `Add ${name} to wardrobe via MCP`);
      return {
        content: [
          {
            type: "text",
            text: `Added: [${nextId}] ${brand} ${name} | ${category} | ${color} | score: ${palette_score}/10 | crossover: ${crossover}${status ? ` | ${status}` : ""}`,
          },
        ],
      };
    }
  );

  return server;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "GET") {
    // Health check
    res.status(200).json({ name: "wardrobe-mcp", version: "1.0.0" });
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
