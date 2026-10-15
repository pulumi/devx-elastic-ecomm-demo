import { describe, expect, it } from "vitest";
import { parseStream } from "./elastic.js";

describe("parseStream", () => {
  it("joins text deltas and reassembles tool-call arguments split across chunks", () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Let me "}}]}',
      'data: {"choices":[{"delta":{"content":"look."}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"fetch_url","arguments":"{\\"url\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"/robots.txt\\"}"}}]}}]}',
      "data: [DONE]",
    ].join("\n\n");
    expect(parseStream(sse)).toEqual({
      text: "Let me look.",
      toolCalls: [{ id: "call_a", name: "fetch_url", input: { url: "/robots.txt" } }],
    });
  });

  it("keeps unparseable arguments instead of throwing", () => {
    const sse = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"finish","arguments":"{oops"}}]}}]}';
    expect(parseStream(sse).toolCalls[0].input).toEqual({ _unparsed: "{oops" });
  });
});
