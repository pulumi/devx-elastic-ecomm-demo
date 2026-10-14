import { randomUUID } from "node:crypto";
import type { ChatModel, Message, ToolSpec } from "../llm/types.js";
import { http, pick, SHOPPING_GOALS, type RunStats } from "../shared.js";

// A real model driving the shop over plain HTTP, the way a browsing agent
// without a JS engine does. It gets a goal and the shop URL — no hints about
// the API — and ends every run with a trip report of what got in its way.
// Those reports are the richest friction signal: they say *why*.

const MAX_STEPS = Number(process.env.LLM_AGENT_MAX_STEPS ?? 16);
const BODY_LIMIT = 5_000;

const TOOLS: ToolSpec[] = [
  {
    name: "fetch_url",
    description:
      "Make an HTTP request to the shop and get back the status, content type and (truncated) body. Only URLs on the shop's own origin are allowed. There is no JavaScript engine: you see the raw response.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL or a path on the shop, e.g. /robots.txt" },
        method: { type: "string", enum: ["GET", "POST", "PATCH", "DELETE"], default: "GET" },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: { type: "string", description: "Request body (send JSON as a string)" },
      },
      required: ["url"],
    },
  },
  {
    name: "finish",
    description: "End the task. Always call this, whether you succeeded or got stuck, with an honest trip report for the shop's owners.",
    parameters: {
      type: "object",
      properties: {
        success: { type: "boolean", description: "Did you fully complete the user's goal?" },
        status: { type: "string", enum: ["completed", "partial", "blocked", "gave_up"] },
        report: {
          type: "string",
          description:
            "3-6 sentences for the shop's owners: what you tried, where you got stuck or slowed down, what information or capability was missing, and what would have made this easy for an agent.",
        },
        obstacles: {
          type: "array",
          items: { type: "string" },
          description: "Short kebab-case tags for each obstacle, e.g. no-server-rendered-content, zero-search-results, undocumented-api, missing-shipping-info",
        },
      },
      required: ["success", "status", "report", "obstacles"],
    },
  },
];

export interface TripReport {
  success: boolean;
  status: string;
  report: string;
  obstacles: string[];
  steps: number;
}

function trim(body: string, contentType: string) {
  let b = body;
  if (contentType.includes("html")) {
    // Keep tags that matter to an agent (script src, links, meta); drop CSS noise.
    b = b.replace(/<style[\s\S]*?<\/style>/g, "").replace(/\s{2,}/g, " ");
  }
  return b.length > BODY_LIMIT ? `${b.slice(0, BODY_LIMIT)}\n…[truncated ${b.length - BODY_LIMIT} chars]` : b;
}

export async function runLlmAgent(
  model: ChatModel,
  target: string,
  onReport: (r: TripReport & { goal: string; sessionId: string; model: string }) => Promise<void>,
): Promise<RunStats> {
  const goal = pick(SHOPPING_GOALS);
  const stats: RunStats = { persona: "agent-llm", variant: model.label, requests: 0, errors: 0, ordered: false };
  const origin = new URL(target).origin;
  const sessionId = `llm-${randomUUID().slice(0, 8)}`;
  const userAgent = `Mozilla/5.0 (compatible; agent-framework/1.0; shopfront-llm-agent; +${model.label})`;

  const system = [
    "You are an AI shopping assistant acting for a user. You can only reach the shop through the fetch_url tool (raw HTTP, no JavaScript).",
    `The shop is at ${origin}. You have at most ${MAX_STEPS} tool calls. Use example.com email addresses if one is needed.`,
    "Work the way a capable general-purpose agent would: read what the shop gives you, look for machine-readable options, and adapt.",
    "When you finish or get stuck, call finish with an honest, specific trip report.",
  ].join("\n");

  const messages: Message[] = [{ role: "user", content: `User request: ${goal}` }];
  let report: TripReport | undefined;

  for (let step = 1; step <= MAX_STEPS && !report; step++) {
    let turn;
    try {
      turn = await model.complete(system, messages, TOOLS);
    } catch (err) {
      stats.errors++;
      stats.note = `model error: ${(err as Error).message.slice(0, 200)}`;
      break;
    }
    messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });
    if (turn.toolCalls.length === 0) {
      messages.push({ role: "user", content: "Continue using the tools, or call finish with your trip report." });
      continue;
    }

    for (const call of turn.toolCalls) {
      if (call.name === "finish") {
        const i = call.input as Partial<TripReport>;
        report = {
          success: !!i.success,
          status: String(i.status ?? "gave_up"),
          report: String(i.report ?? turn.text ?? ""),
          obstacles: Array.isArray(i.obstacles) ? i.obstacles.map(String) : [],
          steps: step,
        };
        messages.push({ role: "tool", toolCallId: call.id, content: "ok" });
        continue;
      }
      const { url = "/", method = "GET", headers = {}, body } = call.input as { url?: string; method?: string; headers?: Record<string, string>; body?: string };
      let resolved: URL;
      try {
        resolved = new URL(url, origin);
      } catch {
        messages.push({ role: "tool", toolCallId: call.id, content: `invalid URL: ${url}` });
        continue;
      }
      if (resolved.origin !== origin) {
        messages.push({ role: "tool", toolCallId: call.id, content: `blocked: only ${origin} is reachable` });
        continue;
      }
      const res = await http(stats, resolved.toString(), {
        method,
        body: typeof body === "string" ? body : body ? JSON.stringify(body) : undefined,
        headers: { ...headers, "User-Agent": userAgent, "X-Agent-Name": "shopfront-llm-agent" },
      });
      if (resolved.pathname === "/api/checkout" && res.status === 201) stats.ordered = true;
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: `HTTP ${res.status}\ncontent-type: ${res.contentType}\n\n${trim(res.body, res.contentType)}`,
      });
    }
  }

  report ??= {
    success: stats.ordered,
    status: "gave_up",
    report: `Ran out of steps (${MAX_STEPS}) without finishing. ${stats.note ?? ""}`.trim(),
    obstacles: ["step-budget-exhausted"],
    steps: MAX_STEPS,
  };
  await onReport({ ...report, goal, sessionId, model: model.label });
  return { ...stats, note: `${report.status}: ${report.obstacles.join(", ")}` };
}
