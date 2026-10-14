import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Separate file (own vitest worker / module registry) so `ELASTICSEARCH_URL`
// can be set *before* `../es-client.js` is first imported — that module
// reads it once at import time, so internal.test.ts (which never sets it)
// can't be reused to exercise the "Elasticsearch configured, Jina isn't"
// branch below.
const TEST_DB = "shopfront.friction-test.sqlite";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = TEST_DB;
  process.env.INTERNAL_API_KEY = "test-secret";
  process.env.ELASTICSEARCH_URL = "http://localhost:9200"; // lazy client, never actually queried below
  if (existsSync(TEST_DB)) rmSync(TEST_DB);
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.ELASTICSEARCH_URL;
  if (existsSync(TEST_DB)) rmSync(TEST_DB);
  if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
  if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
});

describe("/internal/friction", () => {
  it("returns 503 when INTERNAL_API_KEY is not set", async () => {
    const saved = process.env.INTERNAL_API_KEY;
    delete process.env.INTERNAL_API_KEY;

    const { buildApp } = await import("../app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/internal/friction" });
    expect(res.statusCode).toBe(503);

    process.env.INTERNAL_API_KEY = saved;
  });

  it("returns 401 without a matching bearer token", async () => {
    const { buildApp } = await import("../app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/internal/friction" });
    expect(res.statusCode).toBe(401);
  });

  it("uses the Elastic-hosted Jina reranker when Elasticsearch is configured, even without JINA_API_KEY", async () => {
    const { rerankBackend } = await import("../rerank.js");
    expect(rerankBackend).toBe("elastic");
  });
});
