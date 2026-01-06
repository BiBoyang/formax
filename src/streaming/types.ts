import type { ToolResult } from '../tools/types'

export type StreamEvent =
  | { type: 'assistant_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_input'; id: string; input: unknown }
  | { type: 'tool_end'; id: string; result: ToolResult }
  | { type: 'error'; error: Error }
  | { type: 'complete' }

export type StreamSink = (ev: StreamEvent) => void

