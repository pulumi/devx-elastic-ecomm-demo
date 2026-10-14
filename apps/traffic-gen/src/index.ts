import { parseArgs } from "node:util";
import { AnthropicModel } from "./llm/anthropic.js";
import { ElasticChatModel } from "./llm/elastic.js";
import type { ChatModel } from "./llm/types.js";
import { runHuman } from "./personas/human.js";
import type { TripReport } from "./personas/llm-agent.js";
import { runLlmAgent } from "./personas/llm-agent.js";
import { runScriptedAgent } from "./personas/scripted-agent.js";
import type { RunStats } from "./shared.js";

// One invocation = one "wave" of shoppers. Locally you run it by hand; on
// AWS an EventBridge schedule starts it as a Fargate task every N minutes.
//
//   npm run traffic -- --target http://localhost:5173 --humans 4 --agents 12 --llm 1

const { values } = parseArgs({
  options: {
    target: { type: "string", default: process.env.TARGET_URL },
    humans: { type: "string", default: process.env.HUMAN_SESSIONS ?? "4" },
    agents: { type: "string", default: process.env.AGENT_SESSIONS ?? "12" },
    llm: { type: "string", default: process.env.LLM_AGENT_RUNS ?? "0" },
    concurrency: { type: "string", default: process.env.CONCURRENCY ?? "4" },
    "spread-seconds": { type: "string", default: process.env.SPREAD_SECONDS ?? "60" },
  },
});

const target = values.target;
if (!target) {
  console.error("Set --target or TARGET_URL to the shop's base URL");
  process.exit(2);
}

const esUrl = process.env.ELASTICSEARCH_URL;
const esKey = process.env.ELASTICSEARCH_API_KEY ?? process.env.ELASTIC_API_KEY;

// LLM agents are off unless a provider is configured. The Elastic-hosted
// chat endpoint is opt-in (LLM_PROVIDER=elastic) because it needs an LLM
// entitlement on the Elastic project.
function chatModel(): ChatModel | undefined {
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicModel(process.env.ANTHROPIC_API_KEY);
  if (process.env.LLM_PROVIDER === "elastic" && esUrl && esKey) return new ElasticChatModel(esUrl, esKey);
  return undefined;
}

async function saveReport(r: TripReport & { goal: string; sessionId: string; model: string }) {
  console.log(`  trip report [${r.status}] ${r.obstacles.join(", ")}\n    ${r.report}`);
  if (!esUrl || !esKey) return;
  const res = await fetch(`${esUrl.replace(/\/$/, "")}/shop-agent-reports/_doc`, {
    method: "POST",
    headers: { Authorization: `ApiKey ${esKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      "@timestamp": new Date().toISOString(),
      session: { id: r.sessionId },
      agent: { name: "shopfront-llm-agent", model: r.model, goal: r.goal },
      outcome: { success: r.success, steps: r.steps, status: r.status },
      report: { text: r.report, raw: r.report, obstacles: r.obstacles },
    }),
  });
  if (!res.ok) console.warn(`  could not store trip report: ${res.status} ${await res.text()}`);
}

type Job = { label: string; run: () => Promise<RunStats> };

const jobs: Job[] = [];
const humans = Number(values.humans);
const agents = Number(values.agents);
const llmRuns = Number(values.llm);

let browser: import("playwright").Browser | undefined;
if (humans > 0) {
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
  for (let i = 0; i < humans; i++) jobs.push({ label: "human", run: () => runHuman(browser!, target) });
}
for (let i = 0; i < agents; i++) jobs.push({ label: "agent", run: () => runScriptedAgent(target) });

const model = llmRuns > 0 ? chatModel() : undefined;
if (llmRuns > 0 && !model) console.warn("LLM agents skipped: set ANTHROPIC_API_KEY, or LLM_PROVIDER=elastic");
if (model) for (let i = 0; i < llmRuns; i++) jobs.push({ label: "llm", run: () => runLlmAgent(model, target, saveReport) });

// Shuffle, then stagger start times across the spread window so arrivals
// look like a stream of visitors rather than one burst.
jobs.sort(() => Math.random() - 0.5);
const spreadMs = Number(values["spread-seconds"]) * 1000;
const concurrency = Math.max(1, Number(values.concurrency));

console.log(`Shopfront traffic wave → ${target}`);
console.log(`  ${humans} human sessions · ${agents} scripted agent sessions · ${model ? llmRuns : 0} LLM agent runs${model ? ` (${model.label})` : ""}`);

const results: RunStats[] = [];
let next = 0;
const started = Date.now();

async function worker() {
  while (next < jobs.length) {
    const i = next++;
    const due = started + (spreadMs * i) / Math.max(1, jobs.length);
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const r = await jobs[i].run().catch((err): RunStats => ({ persona: "agent-scripted", variant: jobs[i].label, requests: 0, errors: 1, ordered: false, note: String(err) }));
    results.push(r);
    console.log(`  ${r.persona.padEnd(15)} ${r.variant.padEnd(40)} req=${String(r.requests).padStart(3)} err=${r.errors}${r.ordered ? " ORDERED" : ""}${r.note ? `  — ${r.note}` : ""}`);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
await browser?.close();

const by = (p: string) => results.filter((r) => r.persona === p);
const summary = ["human-browser", "agent-scripted", "agent-llm"].map((p) => {
  const rs = by(p);
  const orders = rs.filter((r) => r.ordered).length;
  return `${p}: ${rs.length} sessions, ${orders} orders (${rs.length ? Math.round((orders / rs.length) * 100) : 0}% conversion)`;
});
console.log(`\nWave complete in ${Math.round((Date.now() - started) / 1000)}s`);
for (const line of summary) console.log(`  ${line}`);
