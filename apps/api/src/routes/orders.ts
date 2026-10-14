import type { FastifyInstance } from "fastify";
import { db } from "../db.js";

function attachItems(order: any) {
  const items = db.prepare("SELECT productId, name, qty, unitPriceCents FROM order_items WHERE orderId = ?").all(order.id);
  return { ...order, items };
}

export async function orderRoutes(app: FastifyInstance) {
  app.get("/api/orders", async (req, reply) => {
    const { email } = req.query as { email?: string };
    if (!email) return reply.code(400).send({ error: "missing_email" });

    const orders = db.prepare("SELECT * FROM orders WHERE email = ? ORDER BY createdAt DESC").all(email);
    return orders.map(attachItems);
  });

  app.get("/api/orders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    if (!order) return reply.code(404).send({ error: "not_found" });
    return attachItems(order);
  });
}
