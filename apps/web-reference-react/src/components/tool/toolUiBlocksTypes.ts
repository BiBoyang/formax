import type { TranscriptItem } from '../../types'
import type { DiffFileViewModel } from '../diff/diffTypes'

export type ToolCallItem = Extract<TranscriptItem, { kind: 'tool_call' }>
export type ToolInputState = NonNullable<ToolCallItem['inputState']>
export type ToolDisplayDensity = 'compact' | 'verbose'

export type ToolStatus = 'running' | 'completed' | 'error' | 'pending'

export type ToolUiBlockHeader = {
  kind: 'header'
  status: ToolStatus
  title: string
  paramsText?: string
  summary?: string
  inputState?: ToolInputState
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

export type ToolUiBlockDiff = {
  kind: 'diff'
  files: DiffFileViewModel[]
}

export type ToolUiBlock = ToolUiBlockHeader | ToolUiBlockDetails | ToolUiBlockInfo | ToolUiBlockDiff
