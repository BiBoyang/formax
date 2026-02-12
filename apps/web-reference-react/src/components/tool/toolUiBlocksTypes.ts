import type { TranscriptItem } from '../../types'

export type ToolCallItem = Extract<TranscriptItem, { kind: 'tool_call' }>

export type ToolStatus = 'running' | 'completed' | 'error' | 'pending'

export type ToolUiBlockHeader = {
  kind: 'header'
  status: ToolStatus
  title: string
  paramsText?: string
  summary?: string
  expandable: boolean
}

export type ToolUiBlockDetails = {
  kind: 'details'
  lines: string[]
}

export type ToolUiBlockInfo = {
  kind: 'info'
  text: string
}

export type ToolUiBlock = ToolUiBlockHeader | ToolUiBlockDetails | ToolUiBlockInfo
