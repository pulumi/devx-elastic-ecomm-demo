import type { FastifyInstance } from "fastify";
import { db, newId } from "../db.js";
import { recordLifecycleEvent } from "../lifecycle.js";
import { recordFriction } from "../traffic.js";
import { getOrCreateCart, serializeCart } from "./cart.js";

export async function checkoutRoutes(app: FastifyInstance) {
  app.post("/api/checkout", async (req, reply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    if (!sessionId) {
      recordFriction(req, "missing_session", "Checkout rejected: requires an X-Session-Id header", { status: 400 });
      return reply.code(400).send({ error: "missing_session_id" });
    }

    const { email } = (req.body ?? {}) as { email?: string };
    if (!email) {
      recordFriction(req, "checkout_error", "Checkout rejected: missing email", { status: 400 });
      return reply.code(400).send({ error: "missing_email" });
    }

    recordLifecycleEvent(req, "checkout_started");

    const cart = getOrCreateCart(sessionId);
    const cartData = serializeCart(cart.id, sessionId);
    if (cartData.items.length === 0) {
      recordFriction(req, "checkout_error", "Checkout rejected: the cart for this session is empty", { status: 400 });
      return reply.code(400).send({ error: "empty_cart" });
    }

    const orderId = newId("order");
    const createdAt = new Date().toISOString();

    const insertOrder = db.prepare(
      "INSERT INTO orders (id, email, status, totalCents, createdAt) VALUES (?, ?, 'paid', ?, ?)"
    );
    const insertItem = db.prepare(
      "INSERT INTO order_items (id, orderId, productId, name, qty, unitPriceCents) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const clearCart = db.prepare("DELETE FROM cart_items WHERE cartId = ?");

    const tx = db.transaction(() => {
      insertOrder.run(orderId, email, cartData.subtotalCents, createdAt);
      for (const item of cartData.items) {
        insertItem.run(newId("oi"), orderId, item.productId, item.name, item.qty, item.priceCents);
      }
      clearCart.run(cart.id);
    });
    tx();

    recordLifecycleEvent(req, "order_completed", { orderId, totalCents: cartData.subtotalCents });

    return reply.code(201).send({
      id: orderId,
      email,
      status: "paid",
      totalCents: cartData.subtotalCents,
      items: cartData.items.map((i) => ({
        productId: i.productId,
        name: i.name,
        qty: i.qty,
        unitPriceCents: i.priceCents,
      })),
      createdAt,
    });
  });
}
