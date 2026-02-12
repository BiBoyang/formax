import type { ThreadMessage, TranscriptItem } from './types'

export type ToolCallTranscriptItem = Extract<TranscriptItem, { kind: 'tool_call' }>

export type ToolEventPatch = {
  turnId: string
  toolUseId?: string
  toolName?: string
  phase: 'start' | 'update' | 'end'
  text?: string
  input?: unknown
  isError?: boolean
}

export function formatToolInputAsParamsText(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return undefined
  const parts = entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  const raw = parts.join(', ')
  return raw.length > 160 ? `${raw.slice(0, 160)}...` : raw
}

function dedupeAppend(lines: string[], line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed) return lines
  if (lines[lines.length - 1] === trimmed) return lines
  return [...lines, trimmed]
}

export function findToolEventTargetIndex(logs: TranscriptItem[], args: Pick<ToolEventPatch, 'turnId' | 'toolUseId'>): number {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const item = logs[index]
    if (
      item.kind === 'tool_call' &&
      item.turnId === args.turnId &&
      item.toolUseId != null &&
      item.toolUseId === args.toolUseId
    ) {
      return index
    }
  }
  return -1
}

export function findLatestToolNameByUseId(logs: TranscriptItem[], toolUseId?: string): string | undefined {
  if (!toolUseId) return undefined
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const item = logs[index]
    if (item.kind !== 'tool_call') continue
    if (item.toolUseId !== toolUseId) continue
    if (typeof item.toolName !== 'string' || !item.toolName.trim()) continue
    return item.toolName
  }
  return undefined
}

export function applyToolEventPatch(args: {
  id: string
  current?: ToolCallTranscriptItem
  patch: ToolEventPatch
}): ToolCallTranscriptItem {
  const { current, patch } = args
  const paramsText = formatToolInputAsParamsText(patch.input)
  const line = typeof patch.text === 'string' ? patch.text.trim() : ''
  const toolName = patch.toolName ?? current?.toolName ?? 'Tool'

  if (current) {
    return {
      ...current,
      ...(patch.toolName ? { toolName: patch.toolName } : {}),
      ...(paramsText ? { paramsText } : {}),
      status:
        patch.phase === 'end'
          ? patch.isError
            ? 'error'
            : 'completed'
          : current.status,
      detailLines: line ? dedupeAppend(current.detailLines, line) : current.detailLines,
      summary: patch.phase === 'end' ? line || current.summary : current.summary,
    }
  }

  return {
    id: args.id,
    kind: 'tool_call',
    turnId: patch.turnId,
    toolUseId: patch.toolUseId,
    toolName,
    ...(paramsText ? { paramsText } : {}),
    status: patch.phase === 'end' ? (patch.isError ? 'error' : 'completed') : 'running',
    summary: patch.phase === 'end' ? line || `${toolName} completed` : `${toolName} running`,
    detailLines: line ? [line] : [],
  }
}

export function mapHistoryToolToTranscript(args: {
  id: string
  turnId?: string
  tool: Extract<ThreadMessage, { kind: 'tool' }>
}): ToolCallTranscriptItem {
  return {
    id: args.id,
    kind: 'tool_call',
    ...(args.turnId ? { turnId: args.turnId } : {}),
    toolUseId: args.tool.toolUseId,
    toolName: args.tool.toolName,
    ...(args.tool.paramsText ? { paramsText: args.tool.paramsText } : {}),
    status: args.tool.status,
    summary: args.tool.summary,
    detailLines: Array.isArray(args.tool.detailLines) ? args.tool.detailLines : [],
  }
}
