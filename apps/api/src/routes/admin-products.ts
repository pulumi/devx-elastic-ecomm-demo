import type { FastifyInstance } from "fastify";
import { db, newId } from "../db.js";
import { requireInternalAuth } from "./internal.js";

// Catalogue management for apps/content-cli. Same shared-secret gate as the
// other /internal routes; never called by the storefront.

export interface ProductInput {
  id?: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  currency?: string;
  inventoryCount?: number;
  imageUrl?: string;
}

function validate(p: Partial<ProductInput>): string | undefined {
  if (!p || typeof p !== "object") return "product must be an object";
  for (const f of ["sku", "name", "description"] as const) {
    if (typeof p[f] !== "string" || !p[f]!.trim()) return `${f} is required`;
  }
  if (!Number.isInteger(p.priceCents) || p.priceCents! < 0) return "priceCents must be a non-negative integer";
  if (p.inventoryCount !== undefined && (!Number.isInteger(p.inventoryCount) || p.inventoryCount < 0)) {
    return "inventoryCount must be a non-negative integer";
  }
  return undefined;
}

function normalise(p: ProductInput) {
  return {
    id: p.id ?? newId("prod"),
    sku: p.sku,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    currency: p.currency ?? "USD",
    inventoryCount: p.inventoryCount ?? 0,
    imageUrl: p.imageUrl ?? "",
  };
}

const upsert = db.prepare(`
  INSERT INTO products (id, sku, name, description, priceCents, currency, inventoryCount, imageUrl)
  VALUES (@id, @sku, @name, @description, @priceCents, @currency, @inventoryCount, @imageUrl)
  ON CONFLICT(id) DO UPDATE SET sku = excluded.sku, name = excluded.name, description = excluded.description,
    priceCents = excluded.priceCents, currency = excluded.currency, inventoryCount = excluded.inventoryCount,
    imageUrl = excluded.imageUrl
`);

export async function adminProductRoutes(app: FastifyInstance) {
  app.get("/internal/products", async (req, reply) => {
    if (!requireInternalAuth(req, reply)) return;
    return db.prepare("SELECT * FROM products ORDER BY id").all();
  });

  app.post("/internal/products", async (req, reply) => {
    if (!requireInternalAuth(req, reply)) return;
    const input = req.body as ProductInput;
    const err = validate(input);
    if (err) return reply.code(400).send({ error: "invalid_product", detail: err });
    const row = normalise(input);
    upsert.run(row);
    return reply.code(201).send(row);
  });

  app.put("/internal/products/:id", async (req, reply) => {
    if (!requireInternalAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const input = { ...(req.body as ProductInput), id };
    const err = validate(input);
    if (err) return reply.code(400).send({ error: "invalid_product", detail: err });
    const row = normalise(input);
    upsert.run(row);
    return row;
  });

  app.delete("/internal/products/:id", async (req, reply) => {
    if (!requireInternalAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const { changes } = db.prepare("DELETE FROM products WHERE id = ?").run(id);
    if (changes === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // Body: { products: ProductInput[], replace?: boolean }. With replace, the
  // catalogue is emptied first so it ends up exactly equal to `products`.
  app.post("/internal/products/bulk", async (req, reply) => {
    if (!requireInternalAuth(req, reply)) return;
    const { products, replace = false } = (req.body ?? {}) as { products?: ProductInput[]; replace?: boolean };
    if (!Array.isArray(products)) return reply.code(400).send({ error: "invalid_body", detail: "products must be an array" });
    for (const [i, p] of products.entries()) {
      const err = validate(p);
      if (err) return reply.code(400).send({ error: "invalid_product", detail: `products[${i}]: ${err}` });
    }
    const rows = products.map(normalise);
    db.transaction(() => {
      if (replace) db.prepare("DELETE FROM products").run();
      for (const row of rows) upsert.run(row);
    })();
    const total = (db.prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number }).c;
    return { written: rows.length, replaced: replace, total };
  });
}
