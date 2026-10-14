import { existsSync, rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = "shopfront.internal-test.sqlite";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = TEST_DB;
  if (existsSync(TEST_DB)) rmSync(TEST_DB);
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
});

afterAll(() => {
  if (existsSync(TEST_DB)) rmSync(TEST_DB);
  if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
  if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
});

describe("/internal/insights", () => {
  it("returns 503 when INTERNAL_API_KEY is not set", async () => {
    const { buildApp } = await import("../app.js");
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/internal/insights" });
    expect(res.statusCode).toBe(503);
  });

  it("returns 401 without a matching bearer token", async () => {
    process.env.INTERNAL_API_KEY = "test-secret";
    const { buildApp } = await import("../app.js");
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/internal/insights" });
    expect(res.statusCode).toBe(401);

    const wrongKey = await app.inject({
      method: "GET",
      url: "/internal/insights",
      headers: { authorization: "Bearer wrong" },
    });
    expect(wrongKey.statusCode).toBe(401);
  });

  it("reports elasticConfigured: false when ELASTICSEARCH_URL is unset", async () => {
    process.env.INTERNAL_API_KEY = "test-secret";
    const { buildApp } = await import("../app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/internal/insights",
      headers: { authorization: "Bearer test-secret" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().elasticConfigured).toBe(false);
  });
});
