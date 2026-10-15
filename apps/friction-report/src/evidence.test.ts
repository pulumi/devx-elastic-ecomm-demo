import { describe, expect, it } from "vitest";
import { funnelEvidence, htmlOnlyEvidence, zeroResultEvidence } from "./evidence.js";

describe("evidence statements", () => {
  it("counts sessions that only ever saw the HTML shell", () => {
    const [e] = htmlOnlyEvidence([
      {
        key: "agent",
        doc_count: 9,
        sessions: {
          buckets: [
            { key: "a", doc_count: 3, api: { doc_count: 0 }, pages: { doc_count: 3 } },
            { key: "b", doc_count: 4, api: { doc_count: 4 }, pages: { doc_count: 0 } },
            { key: "c", doc_count: 2, api: { doc_count: 0 }, pages: { doc_count: 2 } },
          ],
        },
      },
    ]);
    expect(e).toMatchObject({ weight: 2, actor: "agent" });
    expect(e.text).toMatch(/^2 of 3 agent sessions only fetched HTML/);
  });

  it("phrases zero-result searches per actor", () => {
    const ev = zeroResultEvidence([{ key: "mug under 20", doc_count: 5, by_actor: { buckets: [{ key: "agent", doc_count: 5 }] } }]);
    expect(ev[0].text).toBe('agent shoppers searched for "mug under 20" 5 times and the shop returned no products.');
  });

  it("computes funnel conversion", () => {
    const [e] = funnelEvidence([
      { key: "human", doc_count: 0, actions: { buckets: [{ key: "session_start", doc_count: 10 }, { key: "order_completed", doc_count: 3 }] } },
    ]);
    expect(e.text).toContain("(30.0% of sessions converted)");
  });
});
