import { describe, expect, it } from "vitest";
import { generateOffline } from "./generate.js";
import { parseCatalogue, skuFor } from "./products.js";

describe("parseCatalogue", () => {
  it("accepts an array or {products}, and converts dollar prices", () => {
    const a = parseCatalogue('[{"name":"Mug","description":"A mug","price":"$18.00"}]');
    const b = parseCatalogue('{"products":[{"name":"Mug","description":"A mug","priceCents":1800,"sku":"M-1"}]}');
    expect(a[0]).toMatchObject({ name: "Mug", priceCents: 1800, currency: "USD", sku: "MUG-01" });
    expect(b[0]).toMatchObject({ sku: "M-1", priceCents: 1800 });
  });

  it("names the product that is invalid", () => {
    expect(() => parseCatalogue('[{"name":"Mug","description":"x"}]')).toThrow(/product 1 \(Mug\).*price/);
  });

  it("reads the repo seed file", async () => {
    const { readFileSync } = await import("node:fs");
    const seed = parseCatalogue(readFileSync(new URL("../../../packages/contracts/seed-data/products.json", import.meta.url), "utf-8"));
    expect(seed.length).toBeGreaterThan(0);
  });
});

describe("generation helpers", () => {
  it("builds SKUs from product names", () => {
    expect(skuFor("Matte Black Ceramic Mug", 2)).toBe("MATT-BLAC-03");
  });

  it("offline generator produces valid, uniquely named products", () => {
    const products = generateOffline(30);
    expect(products).toHaveLength(30);
    expect(new Set(products.map((p) => p.name)).size).toBe(30);
    expect(products.every((p) => Number.isInteger(p.priceCents) && p.priceCents > 0)).toBe(true);
  });
});
