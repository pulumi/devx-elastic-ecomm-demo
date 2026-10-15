import type { FastifyInstance } from "fastify";
import { db, newId } from "../db.js";
import { recordLifecycleEvent } from "../lifecycle.js";
import { recordFriction } from "../traffic.js";

function getOrCreateCart(sessionId: string) {
  let cart = db.prepare("SELECT * FROM carts WHERE sessionId = ?").get(sessionId) as { id: string; sessionId: string } | undefined;
  if (!cart) {
    const id = newId("cart");
    db.prepare("INSERT INTO carts (id, sessionId) VALUES (?, ?)").run(id, sessionId);
    cart = { id, sessionId };
  }
  return cart;
}

function serializeCart(cartId: string, sessionId: string) {
  const rows = db
    .prepare(
      `SELECT ci.id, ci.productId, ci.qty, p.name, p.priceCents
       FROM cart_items ci JOIN products p ON p.id = ci.productId
       WHERE ci.cartId = ?`
    )
    .all(cartId) as { id: string; productId: string; qty: number; name: string; priceCents: number }[];

  const subtotalCents = rows.reduce((sum, r) => sum + r.priceCents * r.qty, 0);
  return { id: cartId, sessionId, items: rows, subtotalCents };
}

function requireSessionId(req: any, reply: any): string | undefined {
  const sessionId = req.headers["x-session-id"] as string | undefined;
  if (!sessionId) {
    recordFriction(req, "missing_session", `${req.method} ${req.url} rejected: the cart requires an X-Session-Id header`, { status: 400 });
    reply.code(400).send({ error: "missing_session_id" });
    return undefined;
  }
  return sessionId;
}

export async function cartRoutes(app: FastifyInstance) {
  app.get("/api/cart", async (req, reply) => {
    const sessionId = requireSessionId(req, reply);
    if (!sessionId) return;
    const cart = getOrCreateCart(sessionId);
    return serializeCart(cart.id, sessionId);
  });

  app.post("/api/cart/items", async (req, reply) => {
    const sessionId = requireSessionId(req, reply);
    if (!sessionId) return;
    const { productId, qty } = req.body as { productId: string; qty: number };

    const product = db.prepare("SELECT id FROM products WHERE id = ?").get(productId);
    if (!product) {
      recordFriction(req, "validation_error", `Add to cart rejected: unknown productId ${JSON.stringify(productId)}`, { status: 400 });
      return reply.code(400).send({ error: "unknown_product" });
    }

    const cart = getOrCreateCart(sessionId);
    const existing = db
      .prepare("SELECT id, qty FROM cart_items WHERE cartId = ? AND productId = ?")
      .get(cart.id, productId) as { id: string; qty: number } | undefined;

    if (existing) {
      db.prepare("UPDATE cart_items SET qty = ? WHERE id = ?").run(existing.qty + qty, existing.id);
    } else {
      db.prepare("INSERT INTO cart_items (id, cartId, productId, qty) VALUES (?, ?, ?, ?)").run(
        newId("item"),
        cart.id,
        productId,
        qty
      );
    }

    recordLifecycleEvent(req, "added_to_cart", { productId, qty });
    return serializeCart(cart.id, sessionId);
  });

  app.patch("/api/cart/items/:itemId", async (req, reply) => {
    const sessionId = requireSessionId(req, reply);
    if (!sessionId) return;
    const { itemId } = req.params as { itemId: string };
    const { qty } = req.body as { qty: number };

    const cart = getOrCreateCart(sessionId);
    db.prepare("UPDATE cart_items SET qty = ? WHERE id = ? AND cartId = ?").run(qty, itemId, cart.id);
    return serializeCart(cart.id, sessionId);
  });

  app.delete("/api/cart/items/:itemId", async (req, reply) => {
    const sessionId = requireSessionId(req, reply);
    if (!sessionId) return;
    const { itemId } = req.params as { itemId: string };

    const cart = getOrCreateCart(sessionId);
    db.prepare("DELETE FROM cart_items WHERE id = ? AND cartId = ?").run(itemId, cart.id);
    return serializeCart(cart.id, sessionId);
  });
}

export { getOrCreateCart, serializeCart };
