/**
 * Streaming Client for Anthropic API
 * 
 * Handles:
 * - Streaming requests with stream:true
 * - SSE event parsing
 * - Tool execution loop
 * - Timeout and abort handling
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  parseAnthropicSSEStream,
  ContentBlock,
  SSECallbacks
} from '../sse/streamingParser'

// Types
export interface StreamClientConfig {
  apiKey: string
  baseURL: string
  model: string
  timeoutMs?: number  // default: 600000 (10 minutes)
}

export interface MessageParam {
  role: 'user' | 'assistant'
  content: any[] | string
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: any
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
}

export interface ToolResult {
  tool_use_id: string
  content: string
  is_error?: boolean
}

export interface StreamCallbacks {
  onTextDelta: (text: string) => void
  onToolStart: (toolName: string, toolId: string) => void
  onToolEnd: (toolId: string, result: string, isError?: boolean) => void
  onError: (error: Error) => void
  onComplete: () => void
}

// Logging
const LOG_DIR = path.resolve(process.cwd(), 'proxy/logs')
const DEBUG_LOG = path.resolve(
  LOG_DIR,
  `mychat-stream-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
)

async function appendLog(label: string, data: Record<string, any>) {
  try {
    await fsp.mkdir(LOG_DIR, { recursive: true })
    const line = `${new Date().toISOString()} ${label} ${JSON.stringify(data)}\n`
    await fsp.appendFile(DEBUG_LOG, line, 'utf8')
  } catch {
    // Swallow logging errors
  }
}

// Default headers for Anthropic API
function getDefaultHeaders(apiKey: string): Record<string, string> {
  return {
    'accept': 'text/event-stream',
    'accept-encoding': 'gzip, deflate, br',
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'interleaved-thinking-2025-05-14',
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-api-key': apiKey,
    'Authorization': `Bearer ${apiKey}`,
    'user-agent': 'claude-cli/2.0.74 (external, claude-vscode, agent-sdk/0.1.75)',
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

function normalizeBaseURL(baseURL?: string): string {
  const raw = baseURL || ''
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

export type ToolExecutor = (call: ToolCall) => Promise<string>

export class StreamClient {
  private config: StreamClientConfig
  private headers: Record<string, string>

  constructor(config: StreamClientConfig) {
    this.config = {
      ...config,
      baseURL: normalizeBaseURL(config.baseURL),
      timeoutMs: config.timeoutMs ?? 600000 // 10 minutes default
    }
    this.headers = getDefaultHeaders(config.apiKey)
  }

  /**
   * Stream a chat conversation with tool execution loop
   */
  async streamChat(
    messages: MessageParam[],
    systemPrompt: any[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks,
    executeToolFn: ToolExecutor,
    signal?: AbortSignal
  ): Promise<void> {
    let loopMessages = [...messages]
    let iteration = 0

    while (true) {
      await appendLog('loop_start', {
        iteration,
        messageCount: loopMessages.length
      })

      // Check abort before starting
      if (signal?.aborted) {
        throw new Error('Request aborted')
      }

      // Make streaming request - tools are executed during streaming
      const { contentBlocks, stopReason, toolResults } = await this.streamRequest(
        loopMessages,
        systemPrompt,
        tools,
        callbacks,
        executeToolFn,
        signal
      )

      await appendLog('response_complete', {
        iteration,
        stopReason,
        blockCount: contentBlocks.length
      })

      // Extract tool calls
      const toolCalls = contentBlocks
        .filter((b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use')
        .map(b => ({ id: b.id!, name: b.name!, input: b.input || {} }))

      // Check loop termination
      if (toolCalls.length === 0 || stopReason !== 'tool_use') {
        await appendLog('loop_exit', { iteration, stopReason, reason: 'no_tool_use' })
        break
      }

      // Build assistant content from blocks
      const assistantContent = contentBlocks.map(block => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text || '' }
        } else if (block.type === 'tool_use') {
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
        } else if (block.type === 'thinking') {
          return { type: 'thinking', thinking: block.thinking }
        }
        return block
      })

      // Append assistant message and tool results to history
      loopMessages = [
        ...loopMessages,
        { role: 'assistant', content: assistantContent },
        ...toolResults.map(r => ({
          role: 'user' as const,
          content: [{
            type: 'tool_result',
            tool_use_id: r.tool_use_id,
            content: r.content,
            ...(r.is_error ? { is_error: true } : {})
          }]
        }))
      ]

      iteration++
    }

    callbacks.onComplete()
  }

  /**
   * Make a single streaming request and parse SSE events
   */
  private async streamRequest(
    messages: MessageParam[],
    systemPrompt: any[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks,
    executeToolFn: ToolExecutor,
    signal?: AbortSignal
  ): Promise<{ contentBlocks: ContentBlock[]; stopReason: string | null; toolResults: ToolResult[] }> {
    const payload = {
      stream: true,
      model: this.config.model,
      max_tokens: 16000,
      messages,
      system: systemPrompt,
      tools
    }

    // Setup timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)

    // Combine signals
    const combinedSignal = signal
      ? this.combineSignals(signal, controller.signal)
      : controller.signal

    // Collect tool results as they are executed
    const toolResults: ToolResult[] = []
    const pendingToolExecutions = new Map<string, Promise<void>>()
    const isAborted = () => combinedSignal.aborted

    try {
      const response = await fetch(`${this.config.baseURL}/messages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: combinedSignal
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      // Parse SSE stream
      const sseCallbacks: SSECallbacks = {
        onTextDelta: (text) => callbacks.onTextDelta(text),
        onToolUseStart: (id, name) => {
          callbacks.onToolStart(name, id)
        },
        onToolUseComplete: async (blockIndex, toolUse) => {
          if (isAborted()) return
          const call: ToolCall = {
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input
          }

          await appendLog('tool_start_immediate', {
            toolId: call.id,
            toolName: call.name,
            blockIndex
          })

          const executionPromise = (async () => {
            if (isAborted()) {
              toolResults.push({
                tool_use_id: call.id,
                content: 'Error: Request aborted',
                is_error: true
              })
              callbacks.onToolEnd(call.id, 'Request aborted', true)
              return
            }
            try {
              const result = await executeToolFn(call)
              toolResults.push({
                tool_use_id: call.id,
                content: result
              })
              callbacks.onToolEnd(call.id, result.slice(0, 500), false)
              await appendLog('tool_done_immediate', {
                toolId: call.id,
                resultPreview: result.slice(0, 200)
              })
            } catch (e) {
              const errorMsg = e instanceof Error ? e.message : String(e)
              toolResults.push({
                tool_use_id: call.id,
                content: `Error: ${errorMsg}`,
                is_error: true
              })
              callbacks.onToolEnd(call.id, errorMsg, true)
              await appendLog('tool_error_immediate', {
                toolId: call.id,
                error: errorMsg
              })
            } finally {
              pendingToolExecutions.delete(call.id)
            }
          })()

          pendingToolExecutions.set(call.id, executionPromise)
        },
        onMessageComplete: () => {
          // Handled by return value
        },
        onError: (error) => callbacks.onError(error)
      }

      const result = await parseAnthropicSSEStream(
        response.body,
        sseCallbacks,
        combinedSignal
      )

      // Wait for all pending tool executions to complete
      await Promise.all(Array.from(pendingToolExecutions.values()))

      // Sort tool results to match the order of tool_use blocks in contentBlocks
      const toolCallOrder = result.contentBlocks
        .filter((b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use')
        .map(b => b.id!)
      
      const sortedToolResults = toolCallOrder
        .map(id => toolResults.find(r => r.tool_use_id === id))
        .filter((r): r is ToolResult => r !== undefined)

      return {
        contentBlocks: result.contentBlocks,
        stopReason: result.stopReason,
        toolResults: sortedToolResults
      }
    } catch (e) {
      await appendLog('request_error', {
        message: e instanceof Error ? e.message : String(e)
      })
      throw e
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Combine multiple abort signals
   */
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

  /**
   * Get the headers being used (for testing)
   */
  getHeaders(): Record<string, string> {
    return { ...this.headers }
  }

  /**
   * Get the config (for testing)
   */
  getConfig(): StreamClientConfig {
    return { ...this.config }
  }
}

/**
 * Create a StreamClient from environment variables
 */
export function createStreamClientFromEnv(): StreamClient {
  const apiKey = process.env.ANTHROPIC_API_KEY2
  const baseURL = process.env.ANTHROPIC_BASE_URL2
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'
  const timeoutMs = Number(process.env.ANTHROPIC_TIMEOUT_MS || 600000)

  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY2')
  if (!baseURL) throw new Error('Missing ANTHROPIC_BASE_URL2')

  return new StreamClient({ apiKey, baseURL, model, timeoutMs })
}
