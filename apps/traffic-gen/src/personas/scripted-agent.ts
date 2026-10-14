import { randomUUID } from "node:crypto";
import { AGENT_SEARCH_TERMS, chance, http, joinUrl, pick, sleep, type HttpResult, type RunStats } from "../shared.js";

// Deterministic imitations of how AI agents actually hit a shop. The UAs
// are the published strings for each product; the behaviours (HTML-only
// reading, API guessing, crawling machine-readable files) mirror what those
// agents do. Nothing here is tuned to fail — failures come from the shop.

interface AgentProfile {
  name: string;
  userAgent: string;
  declare: boolean; // sends X-Agent-Name (a self-identifying agent)
}

const PROFILES = {
  chatgptUser: { name: "ChatGPT-User", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", declare: false },
  claudeUser: { name: "Claude-User", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)", declare: false },
  perplexityUser: { name: "Perplexity-User", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)", declare: false },
  gptBot: { name: "GPTBot", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)", declare: false },
  claudeBot: { name: "ClaudeBot", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", declare: false },
  mcpClient: { name: "shop-assistant-mcp", userAgent: "mcp-client/1.4 (shop-assistant; node)", declare: true },
  framework: { name: "procurement-agent", userAgent: "agent-framework/0.9 python-httpx/0.27", declare: true },
  // Browser automation that doesn't identify itself: Chrome UA, but no JS
  // execution and no Sec-Fetch-* headers. Should land in agent-suspected.
  undeclared: { name: "undeclared", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", declare: false },
} satisfies Record<string, AgentProfile>;

type Variant = "html-reader" | "api-explorer" | "crawler" | "undeclared-automation";

const VARIANTS: { variant: Variant; weight: number; profiles: AgentProfile[] }[] = [
  { variant: "html-reader", weight: 3, profiles: [PROFILES.chatgptUser, PROFILES.claudeUser, PROFILES.perplexityUser] },
  { variant: "api-explorer", weight: 4, profiles: [PROFILES.mcpClient, PROFILES.framework, PROFILES.claudeUser, PROFILES.chatgptUser] },
  { variant: "crawler", weight: 2, profiles: [PROFILES.gptBot, PROFILES.claudeBot] },
  { variant: "undeclared-automation", weight: 2, profiles: [PROFILES.undeclared] },
];

function pickVariant() {
  const total = VARIANTS.reduce((s, v) => s + v.weight, 0);
  let r = Math.random() * total;
  for (const v of VARIANTS) if ((r -= v.weight) < 0) return v;
  return VARIANTS[0];
}

// Agents act fast: sub-second gaps between requests.
const agentPause = () => sleep(150 + Math.random() * 600);

function headersFor(profile: AgentProfile, extra: Record<string, string> = {}) {
  return {
    "User-Agent": profile.userAgent,
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    ...(profile.declare ? { "X-Agent-Name": profile.name } : {}),
    ...extra,
  };
}

function hasProductContent(page: HttpResult) {
  // The SPA shell is an empty <div id="root">; real content would include a price.
  return /\$\d|priceCents|"price"/.test(page.body);
}

export async function runScriptedAgent(target: string): Promise<RunStats> {
  const { variant, profiles } = pickVariant();
  const profile = pick(profiles);
  const stats: RunStats = { persona: "agent-scripted", variant: `${variant}:${profile.name}`, requests: 0, errors: 0, ordered: false };
  const get = (path: string, extra?: Record<string, string>) => http(stats, joinUrl(target, path), { headers: headersFor(profile, extra) });

  switch (variant) {
    case "html-reader": {
      // Reads pages like a person would, but never executes JavaScript.
      if (chance(0.6)) await get("/robots.txt");
      const home = await get("/");
      await agentPause();
      const links = [...home.body.matchAll(/href="(\/products\/[^"]+)"/g)].map((m) => m[1]);
      if (links.length === 0) {
        // Nothing to follow; try the URLs an assistant would guess.
        for (const guess of ["/products", "/search?q=mug", "/products/mug"]) {
          const page = await get(guess);
          await agentPause();
          if (hasProductContent(page)) return { ...stats, note: "found content" };
        }
        return { ...stats, note: "HTML had no product content or links; gave up" };
      }
      return stats;
    }

    case "crawler": {
      for (const path of ["/robots.txt", "/sitemap.xml", "/llms.txt", "/.well-known/ai-plugin.json", "/"]) {
        await get(path);
        await agentPause();
      }
      for (let i = 1; i <= 3 + Math.floor(Math.random() * 5); i++) {
        await get(`/products/prod_${String(i).padStart(3, "0")}`);
        await agentPause();
      }
      return { ...stats, note: "crawled; no sitemap or machine-readable catalogue" };
    }

    case "api-explorer":
    case "undeclared-automation": {
      // Looks for an API description first, then calls the JSON API the
      // storefront uses (discoverable from its bundle / network tab).
      if (chance(0.5)) await get("/openapi.json");
      await agentPause();

      let products: { id: string; name: string; priceCents: number }[] = [];
      for (let attempt = 0; attempt < 3 && products.length === 0; attempt++) {
        const term = pick(AGENT_SEARCH_TERMS);
        const res = await get(`/api/products?q=${encodeURIComponent(term)}`, { Accept: "application/json" });
        await agentPause();
        try {
          products = JSON.parse(res.body).items ?? [];
        } catch {
          products = [];
        }
      }
      if (products.length === 0) return { ...stats, note: "every search returned zero results" };

      const product = pick(products);
      await get(`/api/products/${product.id}`, { Accept: "application/json" });
      await agentPause();
      if (!chance(0.7)) return { ...stats, note: "compared products, did not buy" };

      // Agents send tool-call arguments the way the model produced them:
      // quantities sometimes arrive as strings.
      const qty = chance(0.15) ? "2" : 1;
      const addBody = JSON.stringify({ productId: product.id, qty });
      const json = { "Content-Type": "application/json", Accept: "application/json" };

      // First attempt without a session header, as most agents do; if the
      // shop rejects it, some agents work out the header and retry.
      let add = await http(stats, joinUrl(target, "/api/cart/items"), { method: "POST", headers: headersFor(profile, json), body: addBody });
      await agentPause();
      const sessionId = randomUUID();
      if (add.status === 400 && add.body.includes("session")) {
        if (!chance(0.6)) return { ...stats, note: "cart rejected the request (missing session); gave up" };
        add = await http(stats, joinUrl(target, "/api/cart/items"), {
          method: "POST",
          headers: headersFor(profile, { ...json, "X-Session-Id": sessionId }),
          body: addBody,
        });
        await agentPause();
      }
      if (add.status >= 400) return { ...stats, note: `add to cart failed (${add.status})` };

      // Agents often don't have the user's email to hand.
      const email = chance(0.8) ? `agent-order-${Math.floor(Math.random() * 1e5)}@example.com` : "";
      const order = await http(stats, joinUrl(target, "/api/checkout"), {
        method: "POST",
        headers: headersFor(profile, { ...json, "X-Session-Id": sessionId }),
        body: JSON.stringify(email ? { email } : {}),
      });
      stats.ordered = order.status === 201;
      return { ...stats, note: stats.ordered ? "ordered" : `checkout failed (${order.status})` };
    }
  }
}
