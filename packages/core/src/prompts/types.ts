import type { ToolResultContent } from '../shared/toolContracts'

export type CacheControl = { type: 'ephemeral' }

export type TextBlock = {
  type: 'text'
  text: string
  cache_control?: CacheControl
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: ToolResultContent
  is_error?: boolean
}

export type ThinkingBlock = {
  type: 'thinking'
  thinking: string
  signature?: string
}

export type PromptBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  // Allow forward-compatible blocks without breaking callers
  | Record<string, any>

export type PromptMessageMeta = {
  compactBoundary?: {
    schemaVersion: 1
    trigger?: 'manual' | 'auto'
    preTokens?: number
    summaryKind?: 'model_summary'
    keepStrategy?: {
      kind: 'keep_last_turns'
      keepLastTurns: number
    }
    rehydrationPlan?: {
      schemaVersion: 1
      items: Array<{
        kind: 'recent_files' | 'plan_state' | 'mode_state'
        priority: 'high' | 'medium'
        status: 'planned' | 'applied'
      }>
    }
  }
}

export type PromptMessage = {
  role: 'user' | 'assistant'
  content: PromptBlock[]
  meta?: PromptMessageMeta
}
