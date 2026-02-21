import type { CanonicalEvent } from '../../semantics'
import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
  type TranscriptProjectionState,
} from '../../semantics'
import { selectTurnSegments } from '../../semantics'
import { selectToolViewModelFromSegment } from '../../../../../src/features/tools/presentation/toolViewModel'
import type { TranscriptItem } from '../../types'

type ProjectionEngineState = {
  logs: TranscriptItem[]
  transcriptProjection: TranscriptProjectionState | null
}

function isProjectionManagedTurnItem(item: TranscriptItem, turnId: string): boolean {
  if (item.turnId !== turnId) return false
  if (item.kind === 'thinking' || item.kind === 'turn_footer' || item.kind === 'tool_call') return true
  return item.kind === 'message' && item.role === 'assistant'
}

export function toTranscriptItemFromProjectionSegment(args: {
  segment: TranscriptProjectionState['segments'][number]
  existingItemById: Map<string, TranscriptItem>
}): TranscriptItem | null {
  const { segment, existingItemById } = args
  if (segment.kind === 'user') {
    return {
      id: segment.id,
      kind: 'message',
      role: 'user',
      turnId: segment.turnId,
      text: segment.text,
    }
  }

  if (segment.kind === 'system') {
    return {
      id: segment.id,
      kind: 'message',
      role: segment.role,
      turnId: segment.turnId,
      text: segment.text,
    }
  }

  if (segment.kind === 'assistant') {
    return {
      id: segment.id,
      kind: 'message',
      role: 'assistant',
      turnId: segment.turnId,
      text: segment.text,
    }
  }

  if (segment.kind === 'thinking') {
    return {
      id: segment.id,
      kind: 'thinking',
      turnId: segment.turnId,
      text: segment.text,
      status: segment.status,
    }
  }

  if (segment.kind === 'tool') {
    const vm = selectToolViewModelFromSegment(segment)
    return {
      id: segment.id,
      kind: 'tool_call',
      turnId: segment.turnId,
      toolUseId: segment.toolUseId,
      toolName: vm.toolName,
      status: vm.status,
      summary: vm.summary,
      detailLines: vm.detailLines,
      ...(vm.paramsText ? { paramsText: vm.paramsText } : {}),
      ...(vm.inputState ? { inputState: vm.inputState } : {}),
    }
  }

  if (segment.kind === 'turn_footer') {
    const existing = existingItemById.get(segment.id)
    const createdAt =
      existing && existing.kind === 'turn_footer' ? existing.createdAt : new Date().toISOString()
    return {
      id: segment.id,
      kind: 'turn_footer',
      turnId: segment.turnId,
      status: segment.status,
      createdAt,
      ...(segment.message ? { message: segment.message } : {}),
    }
  }

  return null
}

export function collectToolNameByUseIdFromLogs(logs: TranscriptItem[]): Record<string, string> {
  const next: Record<string, string> = {}
  for (const item of logs) {
    if (item.kind !== 'tool_call') continue
    if (typeof item.toolUseId !== 'string' || !item.toolUseId.trim()) continue
    if (typeof item.toolName !== 'string') continue
    const toolName = item.toolName.trim()
    if (!toolName || toolName === 'Tool') continue
    next[item.toolUseId] = toolName
  }
  return next
}

function mergeTurnProjectionLogs(args: {
  logs: TranscriptItem[]
  turnId: string
  projectedItems: TranscriptItem[]
}): TranscriptItem[] {
  const { logs, turnId, projectedItems } = args
  const pendingProjectionItems = [...projectedItems]
  const projectedItemIds = new Set(projectedItems.map((item) => item.id))
  const merged: TranscriptItem[] = []
  for (const item of logs) {
    if (isProjectionManagedTurnItem(item, turnId) || projectedItemIds.has(item.id)) {
      if (pendingProjectionItems.length > 0) {
        merged.push(pendingProjectionItems.shift()!)
      }
      continue
    }
    merged.push(item)
  }
  if (pendingProjectionItems.length === 0) return merged

  let insertionIndex = merged.length
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    if (merged[index]?.turnId === turnId) {
      insertionIndex = index + 1
      break
    }
  }
  return [...merged.slice(0, insertionIndex), ...pendingProjectionItems, ...merged.slice(insertionIndex)]
}

export function applyCanonicalProjectionEvent(args: {
  state: ProjectionEngineState
  event: CanonicalEvent
}): ProjectionEngineState {
  const { state, event } = args
  if (!event.threadId || !event.turnId) return state
  const currentProjection =
    state.transcriptProjection && state.transcriptProjection.threadId === event.threadId
      ? state.transcriptProjection
      : (() => {
          const seeded = createInitialTranscriptProjectionState({ threadId: event.threadId })
          const toolNameByUseId = collectToolNameByUseIdFromLogs(state.logs)
          if (Object.keys(toolNameByUseId).length === 0) return seeded
          return {
            ...seeded,
            toolNameByUseId,
          }
        })()
  const nextProjection = reduceTranscriptProjection(currentProjection, event)
  const existingItemById = new Map(state.logs.map((item) => [item.id, item]))
  const projectedItems = selectTurnSegments(nextProjection.segments, event.turnId)
    .filter((segment) => segment.kind !== 'user')
    .map((segment) => toTranscriptItemFromProjectionSegment({ segment, existingItemById }))
    .filter((segment): segment is TranscriptItem => Boolean(segment))
  const logs = mergeTurnProjectionLogs({
    logs: state.logs,
    turnId: event.turnId,
    projectedItems,
  })
  return {
    logs,
    transcriptProjection: nextProjection,
  }
}
