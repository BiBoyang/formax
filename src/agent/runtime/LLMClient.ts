import { StreamChatParams, LLMResponseChunk } from '../types';
import { parseAnthropicSSEStream } from '../sse/parseAnthropicSSE';

type ClientOptions = {
  apiKey: string;
  baseURL?: string;
};

/**
 * Minimal Anthropic streaming client using fetch + SSE parser.
 * Note: this is a thin wrapper; error handling kept simple for initial integration.
 */
export class LLMClient {
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL ?? 'https://api.anthropic.com';
  }

  async *streamChat(params: StreamChatParams): AsyncGenerator<LLMResponseChunk> {
    const url = `${this.baseURL}/v1/messages`;
    const body = {
      model: params.model,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
      max_tokens: params.max_tokens ?? 4096,
      stream: true,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        // 某些 Anthropic 兼容网关要求 Authorization 头
        Authorization: `Bearer ${this.apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`LLM request failed: ${resp.status} ${resp.statusText}`);
    }

    const stream = resp.body;
    const queue: LLMResponseChunk[] = [];
    let resolveNext: ((value: IteratorResult<LLMResponseChunk>) => void) | null = null;

    // Kick off parsing in background
    parseAnthropicSSEStream(stream, (chunk) => {
      queue.push(chunk);
      if (resolveNext) {
        resolveNext({ value: queue.shift()!, done: false });
        resolveNext = null;
      }
    }).then(() => {
      if (resolveNext) {
        resolveNext({ value: undefined as any, done: true });
      }
    });

    while (true) {
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      const next = await new Promise<IteratorResult<LLMResponseChunk>>((resolve) => {
        resolveNext = resolve;
      });
      if (next.done) break;
      yield next.value;
    }
  }
}
