import type { ThreadMessage, TranscriptItem } from './types'

export type ToolCallTranscriptItem = Extract<TranscriptItem, { kind: 'tool_call' }>

export function formatToolInputAsParamsText(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return undefined
  const parts = entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  const raw = parts.join(', ')
  return raw.length > 160 ? `${raw.slice(0, 160)}...` : raw
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
    ...(args.tool.input ? { input: args.tool.input } : {}),
    ...(args.tool.paramsText ? { paramsText: args.tool.paramsText } : {}),
    status: args.tool.status,
    summary: args.tool.summary,
    detailLines: Array.isArray(args.tool.detailLines) ? args.tool.detailLines : [],
  }
}
