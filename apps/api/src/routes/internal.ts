import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { esClient, isElasticConfigured } from "../es-client.js";
import { rerank, rerankBackend } from "../rerank.js";

// Endpoints meant to be called by a coding harness / AI dev agent (not the
// storefront frontend) to pull real traffic-classification signal before
// deciding what to build or fix. Gated by a shared secret — never expose
// this route group publicly without INTERNAL_API_KEY set.
export function requireInternalAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    reply.code(503).send({ error: "internal_api_disabled", detail: "INTERNAL_API_KEY is not set" });
    return false;
  }
  const header = req.headers.authorization;
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (provided !== expected) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

export async function internalRoutes(app: FastifyInstance) {
  app.get("/internal/insights", async (req, reply) => {
    if (!requireInternalAuth(req, reply)) return;

    if (!isElasticConfigured || !esClient) {
      return reply.code(200).send({
        elasticConfigured: false,
        message: "ELASTICSEARCH_URL is not set — no traffic-classification data available yet. See infra/pulumi to stand up a deployment.",
      });
    }

    const window = (req.query as { window?: string }).window ?? "24h";

    try {
      const [classificationAgg, funnelAgg] = await Promise.all([
        esClient.search({
          index: "traffic-classification-*",
          size: 0,
          query: { range: { "@timestamp": { gte: `now-${window}` } } },
          aggs: {
            by_classification: { terms: { field: "traffic.classification", size: 10 } },
            by_actor: { terms: { field: "traffic.actor", size: 5 } },
          },
        }),
        esClient.search({
          index: "user-lifecycle-events-*",
          size: 0,
          query: { range: { "@timestamp": { gte: `now-${window}` } } },
          aggs: { by_action: { terms: { field: "event.action", size: 10 } } },
        }),
      ]);

      return reply.send({
        elasticConfigured: true,
        window,
        trafficClassification: classificationAgg.aggregations?.by_classification ?? null,
        trafficActor: classificationAgg.aggregations?.by_actor ?? null,
        lifecycleFunnel: funnelAgg.aggregations?.by_action ?? null,
      });
    } catch (err) {
      req.log.error({ err }, "internal insights query failed");
      return reply.code(502).send({ error: "elasticsearch_query_failed" });
    }
  });

  // Ranks product pages by "friction" — how often a page is viewed without
  // converting to a cart add — by turning each product's view/add-to-cart
  // counts into a short text summary and letting the reranker score how
  // well each summary matches a friction-describing query. There's no raw
  // page-content index to rerank against yet, so this reranks synthesized
  // funnel summaries; swap in real page text (e.g. via a reader model) once
  // that exists.
  app.get("/internal/friction", async (req, reply) => {
    if (!requireInternalAuth(req, reply)) return;

    if (!isElasticConfigured || !esClient) {
      return reply.code(200).send({
        elasticConfigured: false,
        message: "ELASTICSEARCH_URL is not set — no lifecycle data available yet. See infra/pulumi to stand up a deployment.",
      });
    }
    if (!rerankBackend) {
      return reply.code(200).send({
        elasticConfigured: true,
        jinaConfigured: false,
        message: "No reranker available — see .env.example to enable friction ranking.",
      });
    }

    const q = req.query as { window?: string; query?: string; limit?: string };
    const window = q.window ?? "7d";
    const limit = q.limit ? Number(q.limit) : 10;
    const query =
      q.query ?? "high-friction product page: many views, very few add-to-carts, likely confusing or broken";

    try {
      const [viewsAgg, cartsAgg] = await Promise.all([
        esClient.search({
          index: "user-lifecycle-events-*",
          size: 0,
          query: {
            bool: {
              filter: [{ term: { "event.action": "product_viewed" } }, { range: { "@timestamp": { gte: `now-${window}` } } }],
            },
          },
          aggs: { by_product: { terms: { field: "product.id", size: 50 } } },
        }),
        esClient.search({
          index: "user-lifecycle-events-*",
          size: 0,
          query: {
            bool: {
              filter: [{ term: { "event.action": "added_to_cart" } }, { range: { "@timestamp": { gte: `now-${window}` } } }],
            },
          },
          aggs: { by_product: { terms: { field: "product.id", size: 50 } } },
        }),
      ]);

      const viewBuckets = (viewsAgg.aggregations?.by_product as { buckets?: { key: string; doc_count: number }[] } | undefined)
        ?.buckets ?? [];
      const cartBuckets = (cartsAgg.aggregations?.by_product as { buckets?: { key: string; doc_count: number }[] } | undefined)
        ?.buckets ?? [];

      const views = new Map(viewBuckets.map((b) => [String(b.key), b.doc_count]));
      const carts = new Map(cartBuckets.map((b) => [String(b.key), b.doc_count]));
      const productIds = [...views.keys()];

      if (productIds.length === 0) {
        return reply.send({ elasticConfigured: true, jinaConfigured: true, rerankBackend, window, query, results: [] });
      }

      const documents = productIds.map((id) => {
        const v = views.get(id) ?? 0;
        const c = carts.get(id) ?? 0;
        const rate = v > 0 ? ((c / v) * 100).toFixed(1) : "0.0";
        return `Product page /product/${id}: ${v} views, ${c} added to cart (${rate}% view-to-cart conversion) in the last ${window}.`;
      });

      const ranked = await rerank(query, documents, limit);

      return reply.send({
        elasticConfigured: true,
        jinaConfigured: true,
        rerankBackend,
        window,
        query,
        results: ranked.map((r) => ({
          productId: productIds[r.index],
          relevanceScore: r.relevanceScore,
          summary: documents[r.index],
        })),
      });
    } catch (err) {
      req.log.error({ err }, "friction ranking failed");
      return reply.code(502).send({ error: "friction_ranking_failed" });
    }
  });
}
