import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { computeSignature } from "./auth.js";
import type { DeployHookConfig } from "./config.js";
import { _resetJobsForTests } from "./jobs.js";
import type { PipelineDeps } from "./pipeline.js";
import type { Runner } from "./exec.js";

const SECRET = "test-webhook-secret";
const config: DeployHookConfig = { webhookSecret: SECRET, gitRemote: "https://example.com/shopfront.git" };

const instantSuccess: Runner = async () => ({ code: 0, stdout: "ok", stderr: "" });
const fastDeps: PipelineDeps = {
  runner: instantSuccess,
  sleep: async () => {},
  mkWorkDir: async () => "/tmp/fake-workdir",
  rmWorkDir: async () => {},
};

function signedRequest(body: unknown) {
  const raw = Buffer.from(JSON.stringify(body));
  const timestamp = String(Date.now());
  return {
    payload: raw,
    headers: {
      "content-type": "application/json",
      "x-signature-256": computeSignature(raw, SECRET),
      "x-timestamp": timestamp,
    },
  };
}

beforeEach(() => {
  _resetJobsForTests();
});

describe("POST /deploy", () => {
  it("rejects a request with no signature", async () => {
    const app = await buildApp(config, fastDeps);
    const res = await app.inject({
      method: "POST",
      url: "/deploy",
      payload: { app: "web", ref: "main", requestedBy: "harness" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a stale timestamp even with a valid signature", async () => {
    const app = await buildApp(config, fastDeps);
    const raw = Buffer.from(JSON.stringify({ app: "web", ref: "main", requestedBy: "harness" }));
    const res = await app.inject({
      method: "POST",
      url: "/deploy",
      headers: {
        "content-type": "application/json",
        "x-signature-256": computeSignature(raw, SECRET),
        "x-timestamp": String(Date.now() - 60 * 60 * 1000),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a valid signature over the wrong body (tamper after signing)", async () => {
    const app = await buildApp(config, fastDeps);
    const signedOverDifferentBody = signedRequest({ app: "web", ref: "main", requestedBy: "harness" });
    const res = await app.inject({
      method: "POST",
      url: "/deploy",
      headers: signedOverDifferentBody.headers,
      payload: Buffer.from(JSON.stringify({ app: "web", ref: "malicious", requestedBy: "harness" })),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid payload even when properly signed", async () => {
    const app = await buildApp(config, fastDeps);
    const req = signedRequest({ app: "not-a-real-app", ref: "main", requestedBy: "harness" });
    const res = await app.inject({ method: "POST", url: "/deploy", headers: req.headers, payload: req.payload });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid signed request, runs the pipeline, and reports success on polling", async () => {
    const app = await buildApp(config, fastDeps);
    const req = signedRequest({ app: "web", ref: "main", requestedBy: "harness" });
    const res = await app.inject({ method: "POST", url: "/deploy", headers: req.headers, payload: req.payload });
    expect(res.statusCode).toBe(202);
    const { id } = res.json();
    expect(id).toBeTruthy();

    let status = "";
    for (let i = 0; i < 50 && status !== "succeeded" && status !== "failed"; i++) {
      const poll = await app.inject({ method: "GET", url: `/deploy/${id}` });
      status = poll.json().status;
      if (status !== "succeeded" && status !== "failed") await new Promise((r) => setTimeout(r, 10));
    }
    expect(status).toBe("succeeded");
  });

  it("404s on an unknown job id", async () => {
    const app = await buildApp(config, fastDeps);
    const res = await app.inject({ method: "GET", url: "/deploy/does-not-exist" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /health", () => {
  it("is unauthenticated and returns ok", async () => {
    const app = await buildApp(config, fastDeps);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
