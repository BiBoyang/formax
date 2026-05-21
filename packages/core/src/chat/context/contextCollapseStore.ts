import type { ContextCollapseMeta } from './contextCollapse'
import type { PromptMessage } from '../../prompts'

export const CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME = 'context_collapse_committed'

export type ContextCollapseCommittedRange = {
  kind: 'model_facing_index_range'
  startIndex: number
  endIndexExclusive: number
}

export type ContextCollapseCommittedEntry = {
  schemaVersion: 1
  id: string
  createdAtMs: number
  source: 'request_collapse'
  collapsedRange: ContextCollapseCommittedRange
  recapMessage: PromptMessage
  metadata: ContextCollapseMeta
}

export type ContextCollapseStoreSnapshot = {
  schemaVersion: 1
  entries: ContextCollapseCommittedEntry[]
}

export function createContextCollapseCommittedEntry(args: {
  id: string
  createdAtMs: number
  source: 'request_collapse'
  collapsedRange: ContextCollapseCommittedRange
  recapMessage: PromptMessage
  metadata: ContextCollapseMeta
}): ContextCollapseCommittedEntry {
  return {
    schemaVersion: 1,
    id: args.id,
    createdAtMs: normalizeCreatedAtMs(args.createdAtMs),
    source: args.source,
    collapsedRange: normalizeCommittedRange(args.collapsedRange),
    recapMessage: args.recapMessage,
    metadata: args.metadata,
  }
}

export function buildContextCollapseStoreSnapshot(args: {
  entries: ContextCollapseCommittedEntry[]
}): ContextCollapseStoreSnapshot {
  return {
    schemaVersion: 1,
    entries: args.entries
      .map((entry) => ({
        ...entry,
        createdAtMs: normalizeCreatedAtMs(entry.createdAtMs),
        collapsedRange: normalizeCommittedRange(entry.collapsedRange),
      }))
      .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id)),
  }
}

function normalizeCommittedRange(range: ContextCollapseCommittedRange): ContextCollapseCommittedRange {
  const startIndex = Number.isInteger(range.startIndex) ? Math.max(0, range.startIndex) : 0
  const rawEnd = Number.isInteger(range.endIndexExclusive) ? range.endIndexExclusive : startIndex + 1
  return {
    kind: 'model_facing_index_range',
    startIndex,
    endIndexExclusive: Math.max(startIndex + 1, rawEnd),
  }
}

function normalizeCreatedAtMs(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}
