import {
  parseAnthropicSSEStream,
  type ContentBlock,
  type SSECallbacks,
} from './sseParser'
import type { PromptBlock, PromptMessage } from '../../prompts'
import type { ToolCall, ToolDefinition, ToolResult } from '../../tools/types'
import type { StreamSink } from '../types'

export interface StreamClientConfig {
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs?: number
}

export interface StreamOnceArgs {
  messages: PromptMessage[]
  system: PromptBlock[]
  tools: ToolDefinition[]
  onEvent: StreamSink
  executeTool: (call: ToolCall) => Promise<ToolResult>
  signal?: AbortSignal
  maxTokens?: number
}

function getDefaultHeaders(apiKey: string): Record<string, string> {
  return {
    accept: 'text/event-stream',
    'accept-encoding': 'gzip, deflate, br',
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'interleaved-thinking-2025-05-14',
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-api-key': apiKey,
    Authorization: `Bearer ${apiKey}`,
    'user-agent':
      'claude-cli/2.0.74 (external, claude-vscode, agent-sdk/0.1.75)',
    'x-app': 'cli',
    'x-stainless-arch': process.arch || 'arm64',
    'x-stainless-helper-method': 'stream',
    'x-stainless-lang': 'js',
    'x-stainless-os': process.platform === 'darwin' ? 'MacOS' : process.platform,
    'x-stainless-package-version': '0.70.0',
    'x-stainless-retry-count': '0',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': process.version,
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = baseUrl || ''
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

export class AnthropicStreamClient {
  private config: StreamClientConfig
  private headers: Record<string, string>

  constructor(config: StreamClientConfig) {
    this.config = {
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl),
      timeoutMs: config.timeoutMs ?? 600000,
    }
    this.headers = getDefaultHeaders(config.apiKey)
  }

  async streamOnce(args: StreamOnceArgs): Promise<{
    contentBlocks: ContentBlock[]
    stopReason: string | null
    toolResults: ToolResult[]
  }> {
    const payload = {
      stream: true,
      model: this.config.model,
      max_tokens: args.maxTokens ?? 16000,
      messages: args.messages,
      system: args.system,
      tools: args.tools,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 600000,
    )

    const combinedSignal = args.signal
      ? this.combineSignals(args.signal, controller.signal)
      : controller.signal

    const toolResults: ToolResult[] = []
    const pendingToolExecutions = new Map<string, Promise<void>>()
    const isAborted = () => combinedSignal.aborted

    try {
      const response = await fetch(`${this.config.baseUrl}/messages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: combinedSignal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const sseCallbacks: SSECallbacks = {
        onTextDelta: (text) => args.onEvent({ type: 'assistant_delta', text }),
        onToolUseStart: (id, name) => {
          args.onEvent({ type: 'tool_start', id, name })
        },
        onToolUseComplete: async (_blockIndex, toolUse) => {
          if (isAborted()) return

          args.onEvent({
            type: 'tool_input',
            id: toolUse.id,
            input: toolUse.input,
          })

          const call: ToolCall = {
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input || {},
          }

          const executionPromise = (async () => {
            if (isAborted()) {
              const aborted: ToolResult = {
                tool_use_id: call.id,
                content: 'Request aborted',
                is_error: true,
              }
              toolResults.push(aborted)
              args.onEvent({ type: 'tool_end', id: call.id, result: aborted })
              return
            }

            try {
              const result = await args.executeTool(call)
              toolResults.push(result)
              args.onEvent({ type: 'tool_end', id: call.id, result })
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              const errResult: ToolResult = {
                tool_use_id: call.id,
                content: `Error: ${msg}`,
                is_error: true,
              }
              toolResults.push(errResult)
              args.onEvent({ type: 'tool_end', id: call.id, result: errResult })
            } finally {
              pendingToolExecutions.delete(call.id)
            }
          })()

          pendingToolExecutions.set(call.id, executionPromise)
        },
        onMessageComplete: () => {
          // handled by return value
        },
        onError: (error) => {
          args.onEvent({ type: 'error', error })
        },
      }

      const result = await parseAnthropicSSEStream(
        response.body,
        sseCallbacks,
        combinedSignal,
      )

      if (result.usage && Object.keys(result.usage).length > 0) {
        args.onEvent({ type: 'usage', usage: result.usage, model: this.config.model })
      }

      await Promise.all(Array.from(pendingToolExecutions.values()))

      const toolCallOrder = result.contentBlocks
        .filter((b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use')
        .map((b) => b.id!)

      const sortedToolResults = toolCallOrder
        .map((id) => toolResults.find((r) => r.tool_use_id === id))
        .filter((r): r is ToolResult => r !== undefined)

      return {
        contentBlocks: result.contentBlocks,
        stopReason: result.stopReason,
        toolResults: sortedToolResults,
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private combineSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController()

    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort()
        break
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    return controller.signal
  }
}
