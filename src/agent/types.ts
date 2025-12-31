export type Role = 'system' | 'user' | 'assistant' | 'tool';

// Claude/Anthropic content blocks we care about
export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type LLMMessage = {
  role: Exclude<Role, 'system'>;
  content: ContentBlock[];
};

export type LLMSystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; input: unknown };
export type ToolRunResult = { tool_use_id: string; content: string; is_error?: boolean };

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export type LLMResponseChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; call: ToolCall }
  | { type: 'stop'; stop_reason: string | null; usage?: Usage };

export type StreamChatParams = {
  model: string;
  system: LLMSystemBlock[];
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  max_tokens?: number;
};

export type ToolExecutor = (call: ToolCall) => Promise<ToolRunResult>;
