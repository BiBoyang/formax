import { LLMResponseChunk, ToolCall, Usage } from '../types';

type SSEHandler = (chunk: LLMResponseChunk) => void;

/**
 * Minimal SSE parser for Anthropic streaming responses.
 * It expects lines beginning with "data: {json}" and ignores other lines.
 */
export async function parseAnthropicSSEStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: SSEHandler,
): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  const reader = stream.getReader();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    // Split on newlines; SSE events are separated by blank lines
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice('data:'.length).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload);
        handleAnthropicEvent(evt, onChunk);
      } catch (e) {
        // swallow parse errors; keep streaming
        console.error('Failed to parse SSE line', e);
      }
    }
  }

  // flush any trailing buffer (best-effort)
  if (buffer.trim().startsWith('data:')) {
    try {
      const payload = buffer.trim().slice('data:'.length).trim();
      const evt = JSON.parse(payload);
      handleAnthropicEvent(evt, onChunk);
    } catch {
      /* ignore */
    }
  }
}

function handleAnthropicEvent(evt: any, onChunk: SSEHandler) {
  if (!evt || typeof evt !== 'object') return;
  const type = evt.type;

  if (type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
    const text = evt.delta.text ?? '';
    if (text) {
      onChunk({ type: 'text_delta', text });
    }
    return;
  }

  if (type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
    const call: ToolCall = {
      id: evt.content_block.id,
      name: evt.content_block.name,
      input: evt.content_block.input_json ?? evt.content_block.input ?? {},
    };
    onChunk({ type: 'tool_use', call });
    return;
  }

  if (type === 'message_delta' || type === 'message_stop') {
    const usage: Usage | undefined = evt.usage;
    onChunk({ type: 'stop', stop_reason: evt.stop_reason ?? null, usage });
    return;
  }
}
