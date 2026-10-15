// Product shape shared with the API's /internal/products endpoints and
// packages/contracts/seed-data/products.json.
export interface Product {
  id?: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  currency?: string;
  inventoryCount?: number;
  imageUrl?: string;
}

// Accepts a bare array, {products: [...]}, or a price given in dollars
// ("price": 18 or "$18.00") so hand-written files stay forgiving.
export function parseCatalogue(text: string): Product[] {
  const data = JSON.parse(text);
  const list: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : [];
  if (list.length === 0) throw new Error("expected a JSON array of products, or {\"products\": [...]}");
  return list.map((raw, i) => normalise(raw as Record<string, unknown>, i));
}

export function normalise(p: Record<string, unknown>, i = 0): Product {
  const where = `product ${i + 1}${p.name ? ` (${p.name})` : ""}`;
  const priceCents =
    typeof p.priceCents === "number"
      ? p.priceCents
      : p.price !== undefined
        ? Math.round(Number(String(p.price).replace(/[^0-9.]/g, "")) * 100)
        : NaN;
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new Error(`${where}: needs priceCents (integer) or price`);
  for (const f of ["name", "description"]) {
    if (typeof p[f] !== "string" || !(p[f] as string).trim()) throw new Error(`${where}: missing ${f}`);
  }
  return {
    ...(typeof p.id === "string" ? { id: p.id } : {}),
    sku: typeof p.sku === "string" && p.sku ? p.sku : skuFor(p.name as string, i),
    name: p.name as string,
    description: p.description as string,
    priceCents,
    currency: typeof p.currency === "string" ? p.currency : "USD",
    inventoryCount: typeof p.inventoryCount === "number" ? p.inventoryCount : 50,
    imageUrl: typeof p.imageUrl === "string" ? p.imageUrl : "",
  };
}

export function skuFor(name: string, i: number) {
  const stem = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.slice(0, 4))
    .join("-");
  return `${stem || "ITEM"}-${String(i + 1).padStart(2, "0")}`;
}
