import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { fetchOutfits, pushOutfits, type OutfitEntry } from "./_outfits.js";

const OutfitPayload = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  item_ids: z.array(z.number().int()).min(1, "at least one item required"),
  rating: z.number().int().min(1).max(10),
  notes: z.string().default(""),
  tags: z.array(z.string()).default([]),
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
      const { outfits } = await fetchOutfits(token);
      res.status(200).json(outfits);
      return;
    }

    if (req.method === "POST") {
      const body = OutfitPayload.parse(req.body);
      const { outfits, sha } = await fetchOutfits(token);
      const nextId = outfits.length ? Math.max(...outfits.map((o) => o.id)) + 1 : 1;
      const newOutfit: OutfitEntry = { id: nextId, ...body };
      await pushOutfits(token, [...outfits, newOutfit], sha, `Log outfit ${body.date}`);
      res.status(201).json(newOutfit);
      return;
    }

    if (req.method === "PUT") {
      const body = z.object({ id: z.number() }).merge(OutfitPayload).parse(req.body);
      const { outfits, sha } = await fetchOutfits(token);
      const idx = outfits.findIndex((o) => o.id === body.id);
      if (idx === -1) {
        res.status(404).json({ error: "Outfit not found" });
        return;
      }
      outfits[idx] = body;
      await pushOutfits(token, outfits, sha, `Update outfit ${body.id}`);
      res.status(200).json(body);
      return;
    }

    if (req.method === "DELETE") {
      const id = parseInt(String(req.query.id), 10);
      if (!id) {
        res.status(400).json({ error: "Missing or invalid id" });
        return;
      }
      const { outfits, sha } = await fetchOutfits(token);
      if (!outfits.find((o) => o.id === id)) {
        res.status(404).json({ error: "Outfit not found" });
        return;
      }
      await pushOutfits(token, outfits.filter((o) => o.id !== id), sha, `Delete outfit ${id}`);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
}
