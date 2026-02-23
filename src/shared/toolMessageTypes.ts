import type React from 'react'
import type { TokenUsage } from '../streaming/types'

export type ToolHeaderStatus = 'running' | 'completed' | 'error'
export type ToolSublineStatus = 'completed' | 'error'

export type ToolUiBlock =
  | ToolUiHeaderBlock
  | ToolUiSublineBlock
  | ToolUiLinesBlock
  | ToolUiCustomBlock

export type ToolUiHeaderBlock = {
  kind: 'header'
  status: ToolHeaderStatus
  label: string
  params?: string | null
}

export type ToolUiSublineBlock = {
  kind: 'subline'
  status: ToolSublineStatus
  text?: string
  children?: React.ReactNode
}

export type ToolUiLinesBlock = {
  kind: 'lines'
  lines: Array<{
    text: string
    tone?: 'default' | 'muted' | 'error'
  }>
}

export type ToolUiCustomBlock = {
  kind: 'custom'
  node: React.ReactNode
}

export type ToolBlocksOutput = {
  blocks: ToolUiBlock[]
}

export interface ToolInfo {
  name: string
  toolUseId?: string
  input: Record<string, any>
  status: 'running' | 'completed' | 'error'
  result?: string
  resultLines?: number
  expandInfo?: string
  middleLines?: string[]
  transcriptLines?: string[]
  nestedTools?: Array<{
    id: string
    name: string
    input: Record<string, any>
    status: 'running' | 'completed' | 'error'
    summary?: string
  }>
  toolUses?: number
  usage?: TokenUsage
  durationMs?: number
  expanded?: boolean
  patchStartLineNumber?: number
}

export interface Msg {
  id: string
  role: 'user' | 'assistant' | 'tool'
  ui?: {
    kind: 'command_subline' | 'thinking_block' | 'compact_boundary' | 'compact_banner' | 'compact_summary'
  }
  content: string
  rawContent?: any[]
  timestamp: Date
  isStreaming?: boolean
  surfaceOwner?: 'static' | 'transient'
  surfaceHint?: 'static' | 'transient'
  toolInfo?: ToolInfo
}
