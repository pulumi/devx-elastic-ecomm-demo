import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { funnelEvidence, frictionEvidence, htmlOnlyEvidence, pathEvidence, reportEvidence, zeroResultEvidence, type Evidence } from "./evidence.js";
import { rankThemes } from "./themes.js";

// Friction report: where do AI agents struggle in the shop, and why?
//
//   1. Pull the facts from Elasticsearch (friction events, traffic,
//      funnel, LLM agent trip reports) and phrase each as a sentence.
//   2. Jina reranker (Elastic Inference Service) scores every sentence
//      against each friction theme.
//   3. Jina embeddings (semantic_text) find the trip reports that best
//      describe each theme, in the agents' own words.
//
// It only *surfaces* friction. Fixing it is a separate decision.

const { values } = parseArgs({
  options: {
    window: { type: "string", default: "24h" },
    out: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const esUrl = process.env.ELASTICSEARCH_URL?.replace(/\/$/, "");
const apiKey = process.env.ELASTICSEARCH_API_KEY ?? process.env.ELASTIC_API_KEY;
if (!esUrl || !apiKey) {
  console.error("Set ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY (or ELASTIC_API_KEY).");
  process.exit(2);
}

export async function es<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${esUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `ApiKey ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

const range = { range: { "@timestamp": { gte: `now-${values.window}` } } };
const byActor = (extra: object = {}) => ({ terms: { field: "traffic.actor", size: 3 }, ...extra });

const [friction, traffic, funnel, reports] = await Promise.all([
  es("/shop-friction-*/_search", {
    size: 0,
    query: range,
    aggs: {
      by_type: { terms: { field: "friction.type", size: 10 }, aggs: { by_actor: byActor({ aggs: { example: { top_hits: { size: 1, _source: ["friction.detail"] } } } }) } },
      zero: { filter: { term: { "friction.type": "zero_results" } }, aggs: { queries: { terms: { field: "friction.search_query", size: 15 }, aggs: { by_actor: byActor() } } } },
      agent_paths: { filter: { term: { "traffic.actor": "agent" } }, aggs: { paths: { terms: { field: "url.path", size: 10 }, aggs: { by_type: { terms: { field: "friction.type", size: 5 } } } } } },
    },
  }),
  es("/traffic-classification-*/_search", {
    size: 0,
    query: range,
    aggs: {
      by_actor: byActor({
        aggs: {
          sessions: {
            terms: { field: "session.id", size: 2000 },
            aggs: { api: { filter: { term: { "traffic.request_kind": "api" } } }, pages: { filter: { term: { "traffic.request_kind": "page" } } } },
          },
        },
      }),
      by_classification: { terms: { field: "traffic.classification", size: 6 } },
    },
  }),
  es("/user-lifecycle-events-*/_search", {
    size: 0,
    query: range,
    aggs: { by_actor: byActor({ aggs: { actions: { terms: { field: "event.action", size: 10 } } } }) },
  }),
  es("/shop-agent-reports/_search", { size: 40, query: range, sort: [{ "@timestamp": "desc" }], _source: ["outcome", "agent", "report.raw", "report.obstacles"] }).catch(() => ({ hits: { hits: [] } })),
]);

const evidence: Evidence[] = [
  ...frictionEvidence(friction.aggregations.by_type.buckets),
  ...zeroResultEvidence(friction.aggregations.zero.queries.buckets),
  ...pathEvidence(friction.aggregations.agent_paths.paths.buckets),
  ...htmlOnlyEvidence(traffic.aggregations.by_actor.buckets),
  ...funnelEvidence(funnel.aggregations.by_actor.buckets),
  ...reportEvidence(reports.hits.hits),
];

if (evidence.length === 0) {
  console.error(`No shop data in the last ${values.window}. Run a traffic wave first.`);
  process.exit(1);
}

const themes = await rankThemes(es, evidence, values.window!);

if (values.json) {
  console.log(JSON.stringify({ window: values.window, themes, evidence }, null, 2));
  process.exit(0);
}

// ---- Markdown -------------------------------------------------------------

const cls = traffic.aggregations.by_classification.buckets.map((b: any) => `${b.key} ${b.doc_count}`).join(" · ");
const funnelLines = funnel.aggregations.by_actor.buckets.map((a: any) => {
  const n = (k: string) => a.actions.buckets.find((b: any) => b.key === k)?.doc_count ?? 0;
  const s = n("session_start");
  return `| ${a.key} | ${s} | ${n("product_viewed")} | ${n("added_to_cart")} | ${n("order_completed")} | ${s ? ((n("order_completed") / s) * 100).toFixed(1) : "0.0"}% |`;
});

const md = [
  `# Shopfront agent friction report`,
  ``,
  `Window: last ${values.window} · generated ${new Date().toISOString()} · ranking by Jina reranker v3.5 and Jina embeddings v5 (Elastic Inference Service)`,
  ``,
  `**Traffic mix:** ${cls || "none"}`,
  ``,
  `| Actor | Sessions | Product views | Add to cart | Orders | Conversion |`,
  `|---|---|---|---|---|---|`,
  ...funnelLines,
  ``,
  `## Friction themes, ranked`,
  ``,
  ...themes.flatMap((t, i) => [
    `### ${i + 1}. ${t.title}  \`score ${t.score.toFixed(2)}\``,
    ``,
    t.question,
    ``,
    `**Evidence** (${t.agentEvents} agent events · ${t.humanEvents} human events):`,
    ...t.evidence.map((e) => `- ${e.text} _(relevance ${e.relevance.toFixed(2)})_`),
    ...(t.quotes.length ? [``, `**In the agents' words:**`, ...t.quotes.map((q) => `> ${q}`)] : []),
    ``,
  ]),
  `---`,
  `This report surfaces friction only; it does not change the shop.`,
  ``,
].join("\n");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = values.out ?? join(repoRoot, "reports", `friction-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.md`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, md);
console.log(md);
console.log(`Saved to ${out}`);
