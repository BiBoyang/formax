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
  compactBoundaryFingerprint: string | null
  recapMessage: PromptMessage
  metadata: ContextCollapseMeta
}

export type ContextCollapseCommitState = {
  collapsedRange: ContextCollapseCommittedRange
  compactBoundaryFingerprint: string
  recapMessage: PromptMessage
}

export type ContextCollapseStoreSnapshot = {
  schemaVersion: 1
  activeCompactBoundaryFingerprint?: string | null
  entries: ContextCollapseCommittedEntry[]
}

export function createContextCollapseCommittedEntry(args: {
  id: string
  createdAtMs: number
  source: 'request_collapse'
  collapsedRange: ContextCollapseCommittedRange
  compactBoundaryFingerprint?: string | null
  recapMessage: PromptMessage
  metadata: ContextCollapseMeta
}): ContextCollapseCommittedEntry {
  return {
    schemaVersion: 1,
    id: args.id,
    createdAtMs: normalizeCreatedAtMs(args.createdAtMs),
    source: args.source,
    collapsedRange: normalizeCommittedRange(args.collapsedRange),
    compactBoundaryFingerprint: normalizeOptionalFingerprint(args.compactBoundaryFingerprint),
    recapMessage: args.recapMessage,
    metadata: args.metadata,
  }
}

export function buildContextCollapseStoreSnapshot(args: {
  entries: ContextCollapseCommittedEntry[]
  activeCompactBoundaryFingerprint?: string | null
}): ContextCollapseStoreSnapshot {
  return {
    schemaVersion: 1,
    activeCompactBoundaryFingerprint: normalizeOptionalFingerprint(args.activeCompactBoundaryFingerprint),
    entries: args.entries
      .map((entry) => ({
        ...entry,
        createdAtMs: normalizeCreatedAtMs(entry.createdAtMs),
        collapsedRange: normalizeCommittedRange(entry.collapsedRange),
        compactBoundaryFingerprint: normalizeOptionalFingerprint(entry.compactBoundaryFingerprint),
      })),
  }
}

export function appendContextCollapseStoreEntry(args: {
  snapshot: ContextCollapseStoreSnapshot | null
  entry: ContextCollapseCommittedEntry
}): ContextCollapseStoreSnapshot {
  return buildContextCollapseStoreSnapshot({
    entries: [...(args.snapshot?.entries ?? []), args.entry],
    activeCompactBoundaryFingerprint: args.snapshot?.activeCompactBoundaryFingerprint ?? args.entry.compactBoundaryFingerprint,
  })
}

export function setContextCollapseStoreActiveCompactBoundaryFingerprint(args: {
  snapshot: ContextCollapseStoreSnapshot | null
  activeCompactBoundaryFingerprint: string | null
}): ContextCollapseStoreSnapshot {
  return buildContextCollapseStoreSnapshot({
    entries: args.snapshot?.entries ?? [],
    activeCompactBoundaryFingerprint: args.activeCompactBoundaryFingerprint,
  })
}

export function requestHistoryContainsExactMessage(args: {
  messages: PromptMessage[]
  message: PromptMessage
}): boolean {
  const expected = JSON.stringify(args.message)
  return args.messages.some((message) => JSON.stringify(message) === expected)
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

function normalizeOptionalFingerprint(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
