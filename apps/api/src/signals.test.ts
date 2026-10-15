import { describe, expect, it } from "vitest";
import { classifyUserAgent, measure, sessionIdFor } from "./signals.js";

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("classifyUserAgent", () => {
  it.each([
    [CHROME, "browser", undefined],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)", "agent", "Claude-User"],
    ["Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)", "agent", "ChatGPT-User"],
    ["Mozilla/5.0 (compatible; ClaudeBot/1.0)", "agent", "ClaudeBot"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1)", "bot", undefined],
    ["Mozilla/5.0 HeadlessChrome/131.0.0.0 Safari/537.36", "bot", undefined],
    ["curl/8.7.1", "tool", undefined],
    ["python-requests/2.32", "tool", undefined],
    ["", "empty", undefined],
  ])("%s -> %s", (ua, uaClass, agentName) => {
    expect(classifyUserAgent(ua)).toEqual(agentName ? { uaClass, agentName } : { uaClass });
  });
});

describe("sessionIdFor", () => {
  it("prefers the X-Session-Id header", () => {
    expect(sessionIdFor({ "x-session-id": "abc" }, "1.2.3.4")).toEqual({ id: "abc", fromHeader: true });
  });

  it("fingerprints IP + UA when the header is missing", () => {
    const a = sessionIdFor({ "user-agent": "curl/8" }, "1.2.3.4");
    const b = sessionIdFor({ "user-agent": "curl/8" }, "1.2.3.4");
    const c = sessionIdFor({ "user-agent": "curl/9" }, "1.2.3.4");
    expect(a.id).toMatch(/^anon-[0-9a-f]{12}$/);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.fromHeader).toBe(false);
  });
});

describe("measure", () => {
  it("counts a declared agent header and the ground-truth persona separately", () => {
    const ctx = measure({ "user-agent": CHROME, "x-agent-name": "shop-bot", "x-synthetic-persona": "agent-scripted" }, "10.0.0.1");
    expect(ctx.signals.declared_agent).toBe(true);
    expect(ctx.agentName).toBe("shop-bot");
    expect(ctx.groundTruth).toBe("agent-scripted");
  });

  it("remembers that a session executed JavaScript for its later requests", () => {
    const headers = { "user-agent": CHROME, "x-session-id": "rum-session", "sec-fetch-mode": "cors" };
    expect(measure(headers, "10.0.0.2").signals.rum_present).toBe(false);
    expect(measure({ ...headers, "x-client-rendered": "1" }, "10.0.0.2").signals.rum_present).toBe(true);
    expect(measure(headers, "10.0.0.2").signals.rum_present).toBe(true);
  });

  it("tracks the per-session request rate over the trailing minute", () => {
    const headers = { "x-session-id": "rate-session" };
    const t0 = 1_000_000;
    expect(measure(headers, "10.0.0.3", t0).signals.rate).toBe(1);
    expect(measure(headers, "10.0.0.3", t0 + 1_000).signals.rate).toBe(2);
    expect(measure(headers, "10.0.0.3", t0 + 120_000).signals.rate).toBe(1);
  });
});
