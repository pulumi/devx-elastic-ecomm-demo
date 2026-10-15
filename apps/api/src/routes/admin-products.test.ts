import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = "shopfront.admin-test.sqlite";
const auth = { authorization: "Bearer test-secret" };

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = TEST_DB;
  process.env.INTERNAL_API_KEY = "test-secret";
  if (existsSync(TEST_DB)) rmSync(TEST_DB);
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) if (existsSync(f)) rmSync(f);
});

const product = { sku: "LAMP-01", name: "Brass Desk Lamp", description: "A lamp.", priceCents: 4900, inventoryCount: 12 };

describe("/internal/products", () => {
  it("requires the internal bearer token", async () => {
    const { buildApp } = await import("../app.js");
    const app = await buildApp();
    expect((await app.inject({ method: "GET", url: "/internal/products" })).statusCode).toBe(401);
  });

  it("creates, updates and deletes a product that then shows in the storefront", async () => {
    const { buildApp } = await import("../app.js");
    const app = await buildApp();

    const created = await app.inject({ method: "POST", url: "/internal/products", headers: auth, payload: product });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    expect(created.json()).toMatchObject({ currency: "USD", imageUrl: "" });

    const updated = await app.inject({ method: "PUT", url: `/internal/products/${id}`, headers: auth, payload: { ...product, priceCents: 3900 } });
    expect(updated.json().priceCents).toBe(3900);

    const storefront = await app.inject({ method: "GET", url: `/api/products/${id}` });
    expect(storefront.json().name).toBe("Brass Desk Lamp");

    expect((await app.inject({ method: "DELETE", url: `/internal/products/${id}`, headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/products/${id}` })).statusCode).toBe(404);
  });

  it("rejects invalid products with a reason", async () => {
    const { buildApp } = await import("../app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/internal/products", headers: auth, payload: { ...product, priceCents: 12.5 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/priceCents/);
  });

  it("bulk-replaces the whole catalogue", async () => {
    const { buildApp } = await import("../app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/products/bulk",
      headers: auth,
      payload: { replace: true, products: [product, { ...product, sku: "LAMP-02", name: "Floor Lamp" }] },
    });
    expect(res.json()).toEqual({ written: 2, replaced: true, total: 2 });
    expect((await app.inject({ method: "GET", url: "/api/products" })).json().total).toBe(2);
  });
});
