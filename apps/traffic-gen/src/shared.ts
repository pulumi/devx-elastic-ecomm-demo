// Shared plumbing for every persona: a fetch wrapper that stamps the
// ground-truth persona header, per-run stats, and small random helpers.

export type Persona = "human-browser" | "agent-scripted" | "agent-llm";

export interface RunStats {
  persona: Persona;
  variant: string;
  requests: number;
  errors: number;
  ordered: boolean;
  note?: string;
}

export interface HttpResult {
  status: number;
  contentType: string;
  body: string;
}

// X-Synthetic-Persona is ground truth for scoring the classifier later. The
// API stores it in traffic.ground_truth; the classification pipeline never
// reads it.
export async function http(
  stats: RunStats,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<HttpResult> {
  stats.requests++;
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { "X-Synthetic-Persona": stats.persona, ...init.headers },
      body: init.body,
      redirect: "follow",
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
    const body = await res.text();
    if (res.status >= 400) stats.errors++;
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", body };
  } catch (err) {
    stats.errors++;
    return { status: 0, contentType: "", body: `request failed: ${(err as Error).message}` };
  }
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function chance(p: number) {
  return Math.random() < p;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Human think time: skewed toward short pauses with the occasional long read.
export function thinkTime(minMs = 1_200, maxMs = 7_000) {
  const r = Math.random() ** 2;
  return sleep(minMs + r * (maxMs - minMs));
}

export function joinUrl(base: string, path: string) {
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

// Shopping intents shared by scripted and LLM agents. Phrased the way a
// person asks an assistant, not the way the catalogue is worded — that gap
// is exactly what the friction analysis is meant to expose.
export const SHOPPING_GOALS = [
  "Buy a black coffee mug that costs less than $20.",
  "Find a reusable water bottle and add two to the cart.",
  "Order a gift for someone who likes houseplants, budget $40.",
  "Find notebooks suitable for bullet journaling and compare prices.",
  "Buy the cheapest pair of socks available and check out.",
  "Find a scented candle and tell me how long it burns.",
  "Get a canvas tote bag delivered; find out the shipping cost.",
  "Buy a pen that won't smudge for a left-handed writer.",
  "Find something waterproof under $30.",
  "Check whether the mug is dishwasher safe before buying it.",
];

// Search terms an agent derives from those goals. Several are phrased
// naturally ("coffee mug under 20") and will miss the shop's LIKE search.
export const AGENT_SEARCH_TERMS = [
  "mug",
  "black coffee mug under 20",
  "water bottle",
  "reusable bottle",
  "houseplant gift",
  "succulent",
  "bullet journal notebook",
  "notebook",
  "cheap socks",
  "socks",
  "candle burn time",
  "candle",
  "tote bag",
  "left handed pen",
  "pen",
  "waterproof",
  "dishwasher safe",
];
