const OWNER = "nmillere";
const REPO = "wardrobe";
const FILE = "outfits.json";
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

export interface OutfitEntry {
  id: number;
  date: string;       // YYYY-MM-DD
  item_ids: number[];
  rating: number;     // 1-10
  notes: string;
  tags: string[];
}

export async function fetchOutfits(token: string): Promise<{ outfits: OutfitEntry[]; sha: string }> {
  const res = await fetch(API_BASE, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (res.status === 404) return { outfits: [], sha: "" };
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content: string; sha: string };
  const json = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
  return { outfits: JSON.parse(json) as OutfitEntry[], sha: data.sha };
}

export async function pushOutfits(
  token: string,
  outfits: OutfitEntry[],
  sha: string,
  message: string
): Promise<void> {
  const content = Buffer.from(JSON.stringify(outfits, null, 2), "utf-8").toString("base64");
  const res = await fetch(API_BASE, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github.v3+json",
    },
    body: JSON.stringify({ message, content, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
}
