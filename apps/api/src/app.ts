import cors from "@fastify/cors";
import Fastify from "fastify";
import { trackSessionStart } from "./lifecycle.js";
import { adminProductRoutes } from "./routes/admin-products.js";
import { internalRoutes } from "./routes/internal.js";
import { cartRoutes } from "./routes/cart.js";
import { checkoutRoutes } from "./routes/checkout.js";
import { orderRoutes } from "./routes/orders.js";
import { productRoutes } from "./routes/products.js";
import { trafficPlugin } from "./traffic.js";

export async function buildApp() {
  // trustProxy: requests arrive via the ALB and nginx, so the client IP is
  // the left-most X-Forwarded-For entry.
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true });

  await app.register(cors, { origin: true });

  // Called directly rather than via register() so its hooks apply to every
  // route instead of being encapsulated in a child context.
  await trafficPlugin(app);

  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/api/") && req.url !== "/api/health") trackSessionStart(req);
  });

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(productRoutes);
  await app.register(cartRoutes);
  await app.register(checkoutRoutes);
  await app.register(orderRoutes);
  await app.register(internalRoutes);
  await app.register(adminProductRoutes);

  return app;
}
