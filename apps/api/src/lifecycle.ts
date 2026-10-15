import type { FastifyRequest } from "fastify";
import { enqueue, esClient, STREAMS } from "./es-client.js";
import { measure, trafficFields } from "./signals.js";

export type LifecycleAction =
  | "session_start"
  | "product_viewed"
  | "added_to_cart"
  | "checkout_started"
  | "order_completed";

interface LifecycleExtra {
  productId?: string;
  qty?: number;
  orderId?: string;
  totalCents?: number;
}

// Fire-and-forget: lifecycle tracking must never slow down or break a
// storefront request. Every failure (including "Elasticsearch isn't
// configured") is swallowed here, not surfaced to the caller.
export function recordLifecycleEvent(req: FastifyRequest, action: LifecycleAction, extra: LifecycleExtra = {}) {
  if (!esClient) return;

  const ctx = req.traffic ?? (req.traffic = measure(req.headers, req.ip));

  enqueue(STREAMS.lifecycle, {
    "@timestamp": new Date().toISOString(),
    client: { ip: req.ip },
    ...trafficFields(ctx),
    event: { action, category: "user-lifecycle" },
    ...(extra.productId ? { product: { id: extra.productId, qty: extra.qty } } : {}),
    ...(extra.orderId ? { order: { id: extra.orderId, total_cents: extra.totalCents } } : {}),
  });
}

// Best-effort, single-process session_start detection. A session seen for
// the first time by this process instance triggers session_start; this is
// not durable across restarts or multiple instances, which is an accepted
// tradeoff for a reference implementation. A production deployment would
// look the session up in Elasticsearch (or Redis) instead.
const seenSessions = new Set<string>();

export function trackSessionStart(req: FastifyRequest) {
  const sessionId = (req.traffic ?? (req.traffic = measure(req.headers, req.ip))).sessionId;
  if (seenSessions.has(sessionId)) return;
  seenSessions.add(sessionId);
  recordLifecycleEvent(req, "session_start");
}
