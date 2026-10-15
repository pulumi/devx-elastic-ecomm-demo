import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = "shopfront.test.sqlite";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = TEST_DB;
  if (existsSync(TEST_DB)) rmSync(TEST_DB);
});

afterAll(() => {
  if (existsSync(TEST_DB)) rmSync(TEST_DB);
  if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
  if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
});

describe("shopfront api", () => {
  it("lists seeded products", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/products" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items[0]).toHaveProperty("priceCents");
  });

  it("walks cart -> checkout -> order history", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();
    const sessionId = "test-session";

    const products = (await app.inject({ method: "GET", url: "/api/products" })).json();
    const productId = products.items[0].id;

    const addRes = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: { "x-session-id": sessionId },
      payload: { productId, qty: 2 },
    });
    expect(addRes.statusCode).toBe(200);
    expect(addRes.json().items).toHaveLength(1);

    const checkoutRes = await app.inject({
      method: "POST",
      url: "/api/checkout",
      headers: { "x-session-id": sessionId },
      payload: { email: "test@example.com" },
    });
    expect(checkoutRes.statusCode).toBe(201);
    const order = checkoutRes.json();
    expect(order.totalCents).toBeGreaterThan(0);

    const historyRes = await app.inject({ method: "GET", url: "/api/orders?email=test@example.com" });
    expect(historyRes.statusCode).toBe(200);
    expect(historyRes.json()).toHaveLength(1);

    const cartAfter = await app.inject({ method: "GET", url: "/api/cart", headers: { "x-session-id": sessionId } });
    expect(cartAfter.json().items).toHaveLength(0);
  });

  it("rejects checkout with an empty cart", async () => {
    const { buildApp } = await import("./app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      headers: { "x-session-id": "empty-cart-session" },
      payload: { email: "nobody@example.com" },
    });
    expect(res.statusCode).toBe(400);
  });
});
