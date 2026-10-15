// A provider-neutral slice of chat + tool calling: just what the shopping
// agent loop needs, so it can run on Anthropic directly or on Claude served
// through the Elastic Inference Service.

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ChatModel {
  readonly label: string;
  complete(system: string, messages: Message[], tools: ToolSpec[]): Promise<{ text: string; toolCalls: ToolCall[] }>;
}
