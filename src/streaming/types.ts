import type { ToolResult } from '../tools/types'

export type TokenUsage = Partial<{
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}>

export type StreamEvent =
  | { type: 'assistant_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_input'; id: string; input: unknown }
  | {
      type: 'tool_update'
      id: string
      middleLines?: string[]
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
  | { type: 'error'; error: Error }
  | { type: 'complete' }

export type StreamSink = (ev: StreamEvent) => void
