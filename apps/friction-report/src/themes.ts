import type { Evidence } from "./evidence.js";

// The questions a shop owner would ask about agent readiness. The reranker
// decides which evidence answers each one; nothing here is keyword-matched.
export const THEMES = [
  {
    id: "no-rendered-content",
    title: "Agents can't see products in the HTML",
    question: "AI agents fetch the shop's HTML pages but get no product names, prices or links because the content only appears after JavaScript runs.",
  },
  {
    id: "search-misses",
    title: "Search doesn't understand how agents ask",
    question: "Searches phrased in natural language (with prices, attributes or intent) return zero results, so agents can't find products that exist.",
  },
  {
    id: "undocumented-api",
    title: "The API is undiscoverable and undocumented",
    question: "There is no machine-readable catalogue, sitemap, llms.txt, robots.txt or API description, so agents guess URLs and endpoints.",
  },
  {
    id: "cart-session",
    title: "Cart and checkout reject agent requests",
    question: "Adding to cart or checking out fails for agents because of hidden requirements such as a session header, leading to errors and retries.",
  },
  {
    id: "missing-product-facts",
    title: "Product facts agents need are missing",
    question: "Agents cannot answer the user's question because product pages lack details like shipping cost, dimensions, materials, care or burn time.",
  },
  {
    id: "conversion-gap",
    title: "Agents convert far less than humans",
    question: "Agent sessions rarely end in an order compared with human sessions, showing agents abandon the purchase.",
  },
] as const;

const RERANK_ID = process.env.ELASTIC_RERANK_INFERENCE_ID ?? ".jina-reranker-v3.5";
const MIN_RELEVANCE = Number(process.env.MIN_RELEVANCE ?? 0.2);

type Es = <T = any>(path: string, body: unknown) => Promise<T>;

export interface RankedTheme {
  id: string;
  title: string;
  question: string;
  score: number;
  agentEvents: number;
  humanEvents: number;
  evidence: (Evidence & { relevance: number })[];
  quotes: string[];
}

export async function rankThemes(es: Es, evidence: Evidence[], window: string): Promise<RankedTheme[]> {
  const docs = evidence.map((e) => e.text);
  const ranked = await Promise.all(
    THEMES.map(async (theme) => {
      const res = await es<{ rerank: { index: number; relevance_score: number }[] }>(`/_inference/rerank/${RERANK_ID}`, {
        query: theme.question,
        input: docs,
        task_settings: { top_n: Math.min(8, docs.length), return_documents: false },
      });
      const matched = res.rerank
        .filter((r) => r.relevance_score >= MIN_RELEVANCE)
        .map((r) => ({ ...evidence[r.index], relevance: r.relevance_score }));

      // Semantic search over the trip reports' Jina embeddings: the agents'
      // own descriptions of this theme.
      const quotes = await es("/shop-agent-reports/_search", {
        size: 3,
        query: { bool: { must: { semantic: { field: "report.text", query: theme.question } }, filter: { range: { "@timestamp": { gte: `now-${window}` } } } } },
        _source: ["report.raw"],
      })
        .then((r: any) => r.hits.hits.filter((h: any) => h._score >= 0.5).map((h: any) => h._source.report.raw as string))
        .catch(() => []);

      const agentEvents = matched.filter((m) => m.actor === "agent").reduce((s, m) => s + m.weight, 0);
      const humanEvents = matched.filter((m) => m.actor === "human").reduce((s, m) => s + m.weight, 0);
      // Relevance-weighted evidence volume, favouring themes that are
      // worse for agents than for humans.
      const volume = matched.reduce((s, m) => s + m.relevance * Math.log1p(m.weight), 0);
      const agentSkew = (agentEvents + 1) / (humanEvents + 1);
      const score = volume * Math.min(3, Math.sqrt(agentSkew)) + quotes.length * 0.5;
      return { id: theme.id, title: theme.title, question: theme.question, score, agentEvents, humanEvents, evidence: matched, quotes };
    }),
  );
  return ranked.filter((t) => t.evidence.length > 0 || t.quotes.length > 0).sort((a, b) => b.score - a.score);
}
