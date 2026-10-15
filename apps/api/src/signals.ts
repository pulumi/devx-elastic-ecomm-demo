import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

// Raw, per-request signals. The API only *measures*; the
// traffic-classification ingest pipeline (elastic/pipelines) decides what
// the measurements mean, so the rules can change without a redeploy.

export type UaClass = "browser" | "agent" | "bot" | "tool" | "empty";

// AI agents and AI crawlers that identify themselves in the User-Agent.
// Checked before the generic "bot" match so e.g. ClaudeBot counts as an
// agent rather than a search crawler.
const AGENT_UA_TOKENS: [token: string, name: string][] = [
  ["claude-user", "Claude-User"],
  ["claude-web", "Claude-Web"],
  ["claudebot", "ClaudeBot"],
  ["anthropic-ai", "anthropic-ai"],
  ["chatgpt-user", "ChatGPT-User"],
  ["chatgpt agent", "ChatGPT Agent"],
  ["oai-searchbot", "OAI-SearchBot"],
  ["gptbot", "GPTBot"],
  ["openai-operator", "OpenAI-Operator"],
  ["perplexity-user", "Perplexity-User"],
  ["perplexitybot", "PerplexityBot"],
  ["googleagent", "GoogleAgent"],
  ["google-agent", "GoogleAgent"],
  ["google-extended", "Google-Extended"],
  ["amazon-nova-act", "Amazon-Nova-Act"],
  ["mcp-client", "mcp-client"],
  ["agent-framework", "agent-framework"],
  ["browserbase", "Browserbase"],
];

const BOT_UA_TOKENS = ["bot", "crawler", "spider", "slurp", "headlesschrome", "phantomjs"];

const TOOL_UA_TOKENS = [
  "curl/",
  "wget/",
  "python-requests",
  "python-httpx",
  "python-urllib",
  "aiohttp",
  "node-fetch",
  "undici",
  "axios/",
  "go-http-client",
  "okhttp",
  "java/",
  "postmanruntime",
  "insomnia",
  "httpie",
];

export function classifyUserAgent(ua: string | undefined): { uaClass: UaClass; agentName?: string } {
  const s = (ua ?? "").toLowerCase().trim();
  if (!s) return { uaClass: "empty" };
  for (const [token, name] of AGENT_UA_TOKENS) {
    if (s.includes(token)) return { uaClass: "agent", agentName: name };
  }
  if (BOT_UA_TOKENS.some((t) => s.includes(t))) return { uaClass: "bot" };
  if (TOOL_UA_TOKENS.some((t) => s.includes(t))) return { uaClass: "tool" };
  if (s.startsWith("mozilla/") && /(chrome|safari|firefox|edg)\//.test(s)) return { uaClass: "browser" };
  return { uaClass: "tool" };
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

// Agents rarely send our X-Session-Id header, so fall back to a stable
// fingerprint of IP + UA to keep their requests grouped into one session.
export function sessionIdFor(headers: IncomingHttpHeaders, ip: string): { id: string; fromHeader: boolean } {
  const fromHeader = header(headers, "x-session-id");
  if (fromHeader) return { id: fromHeader, fromHeader: true };
  const digest = createHash("sha1")
    .update(`${ip}|${header(headers, "user-agent") ?? ""}`)
    .digest("hex")
    .slice(0, 12);
  return { id: `anon-${digest}`, fromHeader: false };
}

const RATE_WINDOW_MS = 60_000;
const recentBySession = new Map<string, number[]>();
const rumSessions = new Set<string>();

// Requests seen for this session in the trailing 60s, including this one.
function recordRate(sessionId: string, now: number): number {
  const kept = (recentBySession.get(sessionId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  kept.push(now);
  recentBySession.set(sessionId, kept);
  if (recentBySession.size > 50_000) recentBySession.clear();
  return kept.length;
}

export interface TrafficContext {
  sessionId: string;
  userAgent: string;
  agentName?: string;
  groundTruth?: string;
  signals: {
    ua_class: UaClass;
    declared_agent: boolean;
    rum_present: boolean;
    sec_fetch_present: boolean;
    session_header_present: boolean;
    rate: number;
  };
}

export function measure(headers: IncomingHttpHeaders, ip: string, now = Date.now()): TrafficContext {
  const userAgent = header(headers, "user-agent") ?? "";
  const { uaClass, agentName: uaAgentName } = classifyUserAgent(userAgent);
  const session = sessionIdFor(headers, ip);

  // Web Bot Auth (Signature-Agent) or our own opt-in header.
  const declaredName = header(headers, "x-agent-name") ?? header(headers, "signature-agent");

  // The storefront's fetch wrapper adds X-Client-Rendered, which only
  // happens once our JavaScript has executed in a real browser. Remember it
  // per session so the session's HTML page fetches count too.
  if (header(headers, "x-client-rendered") === "1") rumSessions.add(session.id);

  return {
    sessionId: session.id,
    userAgent,
    agentName: declaredName ?? uaAgentName,
    groundTruth: header(headers, "x-synthetic-persona"),
    signals: {
      ua_class: uaClass,
      declared_agent: !!declaredName,
      rum_present: rumSessions.has(session.id),
      sec_fetch_present: !!header(headers, "sec-fetch-mode"),
      session_header_present: session.fromHeader,
      rate: recordRate(session.id, now),
    },
  };
}

// The classification fields every shopfront document carries, so friction
// and lifecycle events can be split by actor with the same pipeline.
export function trafficFields(ctx: TrafficContext) {
  return {
    session: { id: ctx.sessionId },
    user_agent: { original: ctx.userAgent },
    traffic: {
      signals: ctx.signals,
      ...(ctx.agentName ? { agent_name: ctx.agentName } : {}),
      ...(ctx.groundTruth ? { ground_truth: ctx.groundTruth } : {}),
    },
  };
}
