import type { FastifyInstance, FastifyRequest } from "fastify";
import { enqueue, STREAMS } from "./es-client.js";
import { measure, trafficFields, type TrafficContext } from "./signals.js";

declare module "fastify" {
  interface FastifyRequest {
    traffic?: TrafficContext;
    frictionRecorded?: boolean;
  }
}

export type FrictionType =
  | "not_found"
  | "zero_results"
  | "validation_error"
  | "missing_session"
  | "checkout_error"
  | "retry"
  | "no_machine_readable";

// Paths an agent typically probes for machine-readable context. The shop
// has none of them, and the SPA fallback answers each with the HTML shell.
const MACHINE_READABLE_PATHS = [/^\/robots\.txt$/, /^\/sitemap.*\.xml$/, /^\/llms(-full)?\.txt$/, /^\/\.well-known\//, /^\/openapi\.(json|ya?ml)$/];

function context(req: FastifyRequest, headersFrom = req.headers): TrafficContext {
  if (!req.traffic) req.traffic = measure(headersFrom, req.ip);
  return req.traffic;
}

function baseDoc(req: FastifyRequest, path: string) {
  const ctx = context(req);
  const [p, query] = path.split("?", 2);
  return {
    "@timestamp": new Date().toISOString(),
    client: { ip: req.ip },
    url: { path: p, ...(query ? { query } : {}) },
    ...trafficFields(ctx),
  };
}

export function recordFriction(req: FastifyRequest, type: FrictionType, detail: string, extra: { searchQuery?: string; path?: string; status?: number } = {}) {
  req.frictionRecorded = true;
  const doc = baseDoc(req, extra.path ?? req.url);
  enqueue(STREAMS.friction, {
    ...doc,
    http: { request: { method: req.method }, ...(extra.status ? { response: { status_code: extra.status } } : {}) },
    friction: { type, detail, ...(extra.searchQuery !== undefined ? { search_query: extra.searchQuery } : {}) },
  });
}

// A request that repeats the same method+path shortly after that path
// failed for this session is a retry — the shopper (or agent) is stuck.
const RETRY_WINDOW_MS = 15_000;
const lastFailure = new Map<string, number>();

function isTracked(url: string) {
  return url.startsWith("/api/") && url !== "/api/health";
}

export async function trafficPlugin(app: FastifyInstance) {
  app.addHook("onRequest", async (req) => {
    if (!isTracked(req.url)) return;
    const ctx = context(req);
    const key = `${ctx.sessionId} ${req.method} ${req.url.split("?")[0]}`;
    const failedAt = lastFailure.get(key);
    if (failedAt && Date.now() - failedAt < RETRY_WINDOW_MS) {
      recordFriction(req, "retry", `Repeated ${req.method} ${req.url.split("?")[0]} within ${RETRY_WINDOW_MS / 1000}s of a failed attempt`);
      req.frictionRecorded = false; // the retry itself may still fail on its own
    }
  });

  app.addHook("onResponse", async (req, reply) => {
    if (!isTracked(req.url)) return;
    const status = reply.statusCode;
    const doc = baseDoc(req, req.url);
    enqueue(STREAMS.traffic, {
      ...doc,
      event: { kind: "event", duration: Math.round(reply.elapsedTime * 1e6) },
      http: { request: { method: req.method }, response: { status_code: status } },
      traffic: { ...doc.traffic, request_kind: "api" },
    });

    const ctx = context(req);
    const key = `${ctx.sessionId} ${req.method} ${req.url.split("?")[0]}`;
    if (status >= 400) lastFailure.set(key, Date.now());
    else lastFailure.delete(key);
    if (lastFailure.size > 50_000) lastFailure.clear();

    // Routes record the specific friction they understand; anything else
    // that failed gets a generic entry so no dead end goes unrecorded.
    if (status >= 400 && !req.frictionRecorded) {
      recordFriction(req, status === 404 ? "not_found" : "validation_error", `${req.method} ${req.url.split("?")[0]} returned ${status}`, { status });
    }
  });

  // nginx mirrors every HTML page request here (see apps/web/nginx.conf) so
  // page fetches that never run our JavaScript — the typical agent — are
  // still visible. The mirror carries the original request headers.
  app.all("/_track/page", async (req, reply) => {
    const original = (req.headers["x-original-uri"] as string | undefined) ?? "/";
    const doc = baseDoc(req, original);
    enqueue(STREAMS.traffic, {
      ...doc,
      http: { request: { method: (req.headers["x-original-method"] as string | undefined) ?? "GET" }, response: { status_code: 200 } },
      traffic: { ...doc.traffic, request_kind: "page" },
    });
    const path = original.split("?")[0];
    if (MACHINE_READABLE_PATHS.some((re) => re.test(path))) {
      recordFriction(req, "no_machine_readable", `Requested ${path}; the shop has no such file and served the SPA HTML shell instead`, { path: original, status: 200 });
    }
    return reply.code(204).send();
  });
}
