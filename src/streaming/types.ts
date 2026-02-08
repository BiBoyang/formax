import type { PromptBlock, PromptMessage } from '../prompts'
import type { ToolCall, ToolDefinition, ToolResult } from '../tools/types'

export type TokenUsage = Partial<{
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}>

export type StopReason = string | null

export type StreamEvent =
  | { type: 'assistant_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'thinking_stop' }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_input'; id: string; input: unknown }
  | {
      type: 'tool_update'
      id: string
      middleLines?: string[]
      /** Optional tool-provided verbose transcript lines (e.g. Task detailed transcript). */
      transcriptLines?: string[]
      toolUses?: number
      usage?: TokenUsage
      nestedTools?: Array<{
        id: string
        name: string
        input: Record<string, any>
        status: 'running' | 'completed' | 'error'
        summary?: string
      }>
    }
  | { type: 'usage'; usage: TokenUsage; model?: string }
  | { type: 'tool_end'; id: string; result: ToolResult }
  | {
      type: 'approval_request'
      toolUseId: string
      toolName: string
      action: unknown
      effectiveDecision: unknown
      suggestions?: string[]
      workspaceRequest?: { dir: string } | null
    }
  | {
      type: 'ask_user_question'
      toolUseId: string
      questions: Array<{
        question: string
        header: string
        fieldId?: string
        options: Array<{ label: string; description: string }>
        multiSelect: boolean
      }>
    }
  | { type: 'error'; error: Error }
  | { type: 'complete' }

export type StreamSink = (ev: StreamEvent) => void

export type StreamTurnResult = {
  assistantBlocks: PromptBlock[]
  stopReason: StopReason
  toolResults: ToolResult[]
  usage?: TokenUsage
}

export type LlmStreamOnceArgs = {
  messages: PromptMessage[]
  system: PromptBlock[]
  tools: ToolDefinition[]
  onEvent: StreamSink
  executeTool: (call: ToolCall) => Promise<ToolResult>
  signal?: AbortSignal
  maxTokens?: number
  /** When false, omit thinking fields/headers (no thinking_delta expected). */
  thinkingEnabled?: boolean
}

export interface LlmStreamClient {
  streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult>
}
