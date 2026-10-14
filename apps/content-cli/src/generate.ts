import Anthropic from "@anthropic-ai/sdk";
import { normalise, type Product } from "./products.js";

// Writes catalogue copy the way a merchant would: product-focused prose.
// It deliberately doesn't ask for agent-friendly structure (specs tables,
// shipping info, structured attributes) — the demo measures how agents cope
// with a typical catalogue, not an idealised one.
export async function generateWithClaude(apiKey: string, count: number, theme: string): Promise<Product[]> {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    max_tokens: 8000,
    tools: [
      {
        name: "save_products",
        description: "Save the generated products to the catalogue.",
        input_schema: {
          type: "object",
          properties: {
            products: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string", description: "1-3 sentences of merchant copy" },
                  priceCents: { type: "integer" },
                  inventoryCount: { type: "integer" },
                  sku: { type: "string" },
                },
                required: ["name", "description", "priceCents", "inventoryCount", "sku"],
              },
            },
          },
          required: ["products"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_products" },
    messages: [
      {
        role: "user",
        content: `Write ${count} products for a small independent online shop selling ${theme}. Realistic names, short merchant-style descriptions, prices between $6 and $120, varied stock levels (a few low or zero). Unique SKUs like MUG-BLK-01.`,
      },
    ],
  });
  const call = res.content.find((b) => b.type === "tool_use");
  if (!call || call.type !== "tool_use") throw new Error("Claude did not return products");
  const products = (call.input as { products: Record<string, unknown>[] }).products;
  return products.map((p, i) => normalise(p, i));
}

// Offline fallback so the tool works without an Anthropic key: combines
// materials, colours and item types into plausible products.
const ITEMS: [item: string, lo: number, hi: number, blurb: string, materials: string[]][] = [
  ["Mug", 1400, 2800, "A sturdy everyday mug that keeps its glaze through years of use.", ["Stoneware", "Enamel", "Porcelain"]],
  ["Tote Bag", 1800, 4200, "Heavy canvas with reinforced handles, roomy enough for a market run.", ["Canvas", "Organic Cotton", "Recycled"]],
  ["Notebook", 900, 2400, "Lay-flat binding and thick paper that takes fountain-pen ink.", ["Linen-Bound", "Recycled", "Dot-Grid"]],
  ["Water Bottle", 2200, 4800, "Double-walled to keep drinks cold all afternoon.", ["Steel", "Glass", "Enamel"]],
  ["Candle", 1600, 3800, "Hand-poured soy wax with a cotton wick.", ["Soy", "Beeswax", "Cedar"]],
  ["Throw Blanket", 4800, 11900, "Soft woven throw for the sofa or the foot of the bed.", ["Merino", "Linen", "Organic Cotton"]],
  ["Planter", 1200, 3600, "Glazed planter with a drainage hole and matching saucer.", ["Stoneware", "Terracotta", "Concrete"]],
  ["Desk Lamp", 3900, 9800, "Adjustable arm and a warm, glare-free light.", ["Brass", "Walnut", "Steel"]],
  ["Cutting Board", 2400, 6400, "Solid hardwood, finished with food-safe oil.", ["Walnut", "Maple", "Bamboo"]],
  ["Scarf", 2200, 5800, "Lightweight knit scarf for in-between weather.", ["Merino", "Linen", "Cashmere"]],
];
const COLOURS = ["Black", "Sage", "Terracotta", "Oat", "Navy", "Charcoal", "Mustard", "Clay"];

export function generateOffline(count: number): Product[] {
  const out: Product[] = [];
  for (let i = 0; i < count; i++) {
    const [item, lo, hi, blurb, materials] = ITEMS[i % ITEMS.length];
    const colour = COLOURS[(i * 3) % COLOURS.length];
    const material = materials[Math.floor(i / ITEMS.length) % materials.length];
    const name = `${colour} ${material} ${item}`;
    const priceCents = Math.round((lo + ((i * 7919) % (hi - lo))) / 100) * 100 - 1;
    out.push(normalise({ name, description: blurb, priceCents, inventoryCount: (i * 37) % 140 }, i));
  }
  return out;
}
