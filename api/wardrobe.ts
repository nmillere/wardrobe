import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { fetchCSV, pushCSV, type WardrobeItem } from "./_csv.js";

const ItemPayload = z.object({
  tags: z.string().min(1),
  brand: z.string(),
  name: z.string().min(1),
  color: z.string(),
  hex: z.string().default("#888888"),
  score: z.number().int().min(1).max(10),
  status: z.enum(["", "incoming", "updated"]).default(""),
  notes: z.string().default(""),
});

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(500).json({ error: "GITHUB_TOKEN not set" });
    return;
  }

  try {
    if (req.method === "GET") {
      const { items } = await fetchCSV(token);
      res.status(200).json(items);
      return;
    }

    if (req.method === "POST") {
      const body = ItemPayload.parse(req.body);
      const { items, sha } = await fetchCSV(token);
      const nextId = items.length ? Math.max(...items.map((i) => i.id)) + 1 : 1;
      const newItem: WardrobeItem = { id: nextId, ...body };
      await pushCSV(token, [...items, newItem], sha, `Add ${body.name} to wardrobe`);
      res.status(201).json(newItem);
      return;
    }

    if (req.method === "PUT") {
      const body = z.object({ id: z.number() }).merge(ItemPayload).parse(req.body);
      const { items, sha } = await fetchCSV(token);
      const idx = items.findIndex((i) => i.id === body.id);
      if (idx === -1) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      items[idx] = body;
      await pushCSV(token, items, sha, `Update ${body.name} in wardrobe`);
      res.status(200).json(body);
      return;
    }

    if (req.method === "DELETE") {
      const id = parseInt(String(req.query.id), 10);
      if (!id) {
        res.status(400).json({ error: "Missing or invalid id" });
        return;
      }
      const { items, sha } = await fetchCSV(token);
      const removed = items.find((i) => i.id === id);
      if (!removed) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      await pushCSV(
        token,
        items.filter((i) => i.id !== id),
        sha,
        `Remove ${removed.name} from wardrobe`
      );
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
}
