import Anthropic from "@anthropic-ai/sdk";
import type { ChatModel, Message, ToolSpec } from "./types.js";

export class AnthropicModel implements ChatModel {
  private client: Anthropic;
  readonly label: string;

  constructor(apiKey: string, private model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5") {
    this.client = new Anthropic({ apiKey });
    this.label = `anthropic:${model}`;
  }

  async complete(system: string, messages: Message[], tools: ToolSpec[]) {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })),
      messages: toAnthropic(messages),
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const toolCalls = res.content.flatMap((b) =>
      b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input as Record<string, unknown> }] : [],
    );
    return { text, toolCalls };
  }
}

// Anthropic wants tool results as user-turn content blocks, and consecutive
// tool results for one assistant turn grouped into a single user message.
function toAnthropic(messages: Message[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
          ...m.toolCalls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input })),
        ],
      });
    } else {
      const block = { type: "tool_result" as const, tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) (last.content as Anthropic.ToolResultBlockParam[]).push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  return out;
}
