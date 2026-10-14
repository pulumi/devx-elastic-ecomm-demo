import type { ChatModel, Message, ToolCall, ToolSpec } from "./types.js";

// Claude via the Elastic Inference Service's unified chat_completion API
// (OpenAI-compatible request shape, streaming-only response). Lets the LLM
// agents run with nothing but the Elasticsearch API key.
export class ElasticChatModel implements ChatModel {
  readonly label: string;

  constructor(
    private esUrl: string,
    private apiKey: string,
    private inferenceId = process.env.ELASTIC_CHAT_INFERENCE_ID ?? ".anthropic-claude-5-sonnet-chat_completion",
  ) {
    this.label = `elastic:${inferenceId}`;
  }

  async complete(system: string, messages: Message[], tools: ToolSpec[]) {
    const res = await fetch(`${this.esUrl.replace(/\/$/, "")}/_inference/chat_completion/${this.inferenceId}/_stream`, {
      method: "POST",
      headers: { Authorization: `ApiKey ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "system", content: system }, ...toOpenAi(messages)],
        tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
        max_completion_tokens: 2048,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) throw new Error(`Elastic chat_completion failed: ${res.status} ${await res.text()}`);
    return parseStream(await res.text());
  }
}

function toOpenAi(messages: Message[]) {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    return {
      role: "assistant",
      content: m.content || undefined,
      ...(m.toolCalls.length
        ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) }
        : {}),
    };
  });
}

// Accumulates OpenAI-style chat.completion.chunk deltas: text arrives in
// pieces, and each tool call's JSON arguments arrive as string fragments
// keyed by index.
export function parseStream(sse: string): { text: string; toolCalls: ToolCall[] } {
  let text = "";
  const calls = new Map<number, { id: string; name: string; args: string }>();
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let chunk: any;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string") text += delta.content;
      for (const tc of delta.tool_calls ?? []) {
        const cur = calls.get(tc.index ?? 0) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(tc.index ?? 0, cur);
      }
    }
  }
  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([i, c]) => {
      let input: Record<string, unknown> = {};
      try {
        input = c.args ? JSON.parse(c.args) : {};
      } catch {
        input = { _unparsed: c.args };
      }
      return { id: c.id || `call_${i}`, name: c.name, input };
    });
  return { text, toolCalls };
}
