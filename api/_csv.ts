const OWNER = "nmillere";
const REPO = "wardrobe";
const FILE = "wardrobe.csv";
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

export interface WardrobeItem {
  id: number;
  tags: string; // pipe-separated: "work|top|casual"
  brand: string;
  name: string;
  color: string;
  hex: string;
  score: number;
  status: string;
  notes: string;
}

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let val = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { val += line[i++]; }
      }
      result.push(val);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) { result.push(line.slice(i)); break; }
      result.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return result;
}

export function parseCSV(csv: string): WardrobeItem[] {
  const lines = csv.trim().split("\n");
  // columns: id, tags, brand, name, color, hex, palette_score, status, notes
  return lines.slice(1).map((line) => {
    const cols = parseCSVRow(line);
    return {
      id: parseInt(cols[0] ?? "0", 10),
      tags: cols[1] ?? "",
      brand: cols[2] ?? "",
      name: cols[3] ?? "",
      color: cols[4] ?? "",
      hex: cols[5] ?? "",
      score: parseInt(cols[6] ?? "5", 10),
      status: cols[7] ?? "",
      notes: cols[8] ?? "",
    };
  }).filter((i) => i.id > 0);
}

export function buildCSV(items: WardrobeItem[]): string {
  const header = "id,tags,brand,name,color,hex,palette_score,status,notes";
  const rows = items.map((i) =>
    [i.id, i.tags, i.brand, i.name, i.color, i.hex, i.score, i.status, i.notes]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...rows].join("\n");
}

export async function fetchCSV(token: string): Promise<{ items: WardrobeItem[]; sha: string }> {
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

export async function pushCSV(
  token: string,
  items: WardrobeItem[],
  sha: string,
  message: string
): Promise<void> {
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
