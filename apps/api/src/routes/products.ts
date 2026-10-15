import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { recordLifecycleEvent } from "../lifecycle.js";
import { recordFriction } from "../traffic.js";

export async function productRoutes(app: FastifyInstance) {
  app.get("/api/products", async (req) => {
    const { q, limit = 20, offset = 0 } = req.query as { q?: string; limit?: number; offset?: number };

    const where = q ? "WHERE name LIKE @q OR description LIKE @q" : "";
    const params = q ? { q: `%${q}%` } : {};

    const items = db
      .prepare(`SELECT * FROM products ${where} ORDER BY name LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: Number(limit), offset: Number(offset) });
    const total = (db.prepare(`SELECT COUNT(*) as c FROM products ${where}`).get(params) as { c: number }).c;

    if (q && total === 0) recordFriction(req, "zero_results", `Search for "${q}" returned no products`, { searchQuery: q });
    return { items, total };
  });

  app.get("/api/products/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!product) {
      recordFriction(req, "not_found", `Product ${id} does not exist`, { status: 404 });
      return reply.code(404).send({ error: "not_found" });
    }
    recordLifecycleEvent(req, "product_viewed", { productId: id });
    return product;
  });
}
