import type React from 'react'
import type { ToolHeaderStatus } from './ToolHeaderLine'
import type { ToolSublineStatus } from './ToolSubline'

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
