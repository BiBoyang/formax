import {
  ContentBlock,
  LLMMessage,
  LLMResponseChunk,
  LLMSystemBlock,
  StreamChatParams,
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolRunResult,
  Usage,
} from '../types';
import { LLMClient } from './LLMClient';

export type AgentLoopOptions = {
  model: string;
  system: LLMSystemBlock[];
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  max_tokens?: number;
  onText?: (text: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (result: ToolRunResult) => void;
};

/**
 * Run a single conversation turn: stream LLM, execute tool_use (via provided executor),
 * append tool_result, loop until无新的 tool_use。
 */
export async function runAgentLoop(
  client: LLMClient,
  execTool: ToolExecutor,
  opts: AgentLoopOptions,
): Promise<LLMMessage[]> {
  const transcript: LLMMessage[] = [...opts.messages];
  let pendingText = '';

  const pushAssistantMessage = (contentBlocks: ContentBlock[]) => {
    transcript.push({ role: 'assistant', content: contentBlocks });
  };

  const streamOnce = async (): Promise<{ toolCalls: ToolCall[] }> => {
    const params: StreamChatParams = {
      model: opts.model,
      system: opts.system,
      messages: transcript,
      tools: opts.tools,
      max_tokens: opts.max_tokens,
    };

    const toolCalls: ToolCall[] = [];
    const contentBlocks: ContentBlock[] = [];

    for await (const chunk of client.streamChat(params)) {
      handleChunk(chunk, {
        onText: (text) => {
          pendingText += text;
          opts.onText?.(text);
        },
        onToolUse: (call) => {
          toolCalls.push(call);
          opts.onToolCall?.(call);
        },
        onStop: () => {
          if (pendingText) {
            contentBlocks.push({ type: 'text', text: pendingText });
            pendingText = '';
          }
        },
      });
    }

    // flush any remaining text after stream ends
    if (pendingText) {
      contentBlocks.push({ type: 'text', text: pendingText });
      pendingText = '';
    }

    if (contentBlocks.length) {
      pushAssistantMessage(contentBlocks);
    }

    return { toolCalls };
  };

  while (true) {
    const { toolCalls } = await streamOnce();
    if (!toolCalls.length) {
      break;
    }

    // Execute tools sequentially (can be parallelized later)
    for (const call of toolCalls) {
      const result = await execTool(call);
      opts.onToolResult?.(result);
      transcript.push({
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            tool_use_id: result.tool_use_id,
            content: result.content,
            is_error: result.is_error,
          },
        ],
      });
    }
  }

  return transcript;
}

type ChunkHandlers = {
  onText: (text: string) => void;
  onToolUse: (call: ToolCall) => void;
  onStop: (usage?: Usage) => void;
};

function handleChunk(chunk: LLMResponseChunk, handlers: ChunkHandlers) {
  if (chunk.type === 'text_delta') {
    handlers.onText(chunk.text);
    return;
  }
  if (chunk.type === 'tool_use') {
    handlers.onToolUse(chunk.call);
    return;
  }
  if (chunk.type === 'stop') {
    handlers.onStop(chunk.usage);
    return;
  }
}
