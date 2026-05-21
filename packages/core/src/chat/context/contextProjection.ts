import { createHash } from 'node:crypto'
import {
  findLatestCompactBoundary,
  findLatestCompactBoundaryIndex,
  fingerprintCompactBoundaryMessage,
  fingerprintPromptMessage,
  getContinuationMessagesAfterLatestCompactBoundary,
  readCompactBoundaryMeta,
  type CompactBoundaryMeta,
} from './compact'
import {
  buildContextCollapseStoreSnapshot,
  type ContextCollapseCommittedEntry,
  type ContextCollapseStoreSnapshot,
} from './contextCollapseStore'
import { dropOrphanToolBlocks } from './toolPairProjection'
import type { PromptMessage } from '../../prompts'

export type ContextProjectionViewKind =
  | 'raw_transcript'
  | 'ui_scrollback'
  | 'model_facing_baseline'
  | 'diagnostics_projection'

export type DurableProjectionStage = 'snip' | 'collapse' | 'tool_result_content_replacement'
export type DurableProjectionStageStatus = 'no_state' | 'deferred' | 'active'

export type DurableProjectionStageFact = {
  stage: DurableProjectionStage
  status: DurableProjectionStageStatus
  applied: boolean
  reason: string
}

export type DurableSnipRemoval = {
  kind: 'model_facing_index_range'
  startIndex: number
  endIndexExclusive: number
  reason?: string
  removedMessageIds?: string[]
  removedMessageFingerprints?: string[]
}

export type DurableSnipState = {
  schemaVersion: 1
  activeCompactBoundaryFingerprint?: string | null
  removals: DurableSnipRemoval[]
}

export type DurableSnipProjectionFact = DurableProjectionStageFact & {
  stage: 'snip'
  status: 'no_state' | 'active'
  removedMessageCount: number
  droppedOrphanToolBlockCount: number
  removals: DurableSnipRemoval[]
}

export type DurableCollapseProjectionFact = DurableProjectionStageFact & {
  stage: 'collapse'
  status: 'no_state' | 'active'
  committedEntryCount: number
  replacedMessageCount: number
  droppedOrphanToolBlockCount: number
  compactBoundaryFingerprint: string | null
}

export type ContextProjectionDurableState = {
  snip: DurableSnipProjectionFact
  collapse: DurableCollapseProjectionFact
  toolResultContentReplacement: DurableProjectionStageFact & {
    stage: 'tool_result_content_replacement'
    status: 'deferred'
  }
}

export type ContextProjectionDurableInputState = {
  snip?: DurableSnipState | null
  collapse?: ContextCollapseStoreSnapshot | null
  toolResultContentReplacement?: null
}

export type ContextProjectionFacts = {
  latestCompactBoundary: CompactBoundaryMeta | null
  activeCompactBoundaryFingerprint: string | null
  rawTranscriptMessageCount: number
  modelFacingBaselineMessageCount: number
  modelFacingBaselineFingerprint: string
  appliedDurableStages: DurableProjectionStage[]
}

export type ContextProjection = {
  rawTranscript: PromptMessage[]
  uiScrollback: PromptMessage[]
  modelFacingBaseline: PromptMessage[]
  diagnosticsProjection: PromptMessage[]
  durableState: ContextProjectionDurableState
  facts: ContextProjectionFacts
}

export function mergeDurableSnipSnapshot(args: {
  existingState?: DurableSnipState | null
  newRemovals: DurableSnipRemoval[]
  compactBoundaryFingerprint: string | null
}): DurableSnipState {
  const existingFingerprint = args.existingState?.activeCompactBoundaryFingerprint ?? null
  const shouldCarryExisting = args.compactBoundaryFingerprint
    ? existingFingerprint === args.compactBoundaryFingerprint
    : existingFingerprint === null
  const existingRemovals = shouldCarryExisting ? cloneDurableSnipRemovals(args.existingState?.removals ?? []) : []
  if (existingRemovals.length === 0) {
    return {
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: args.compactBoundaryFingerprint,
      removals: cloneDurableSnipRemovals(args.newRemovals),
    }
  }

  const removedOriginalIndexes = new Set<number>()
  for (const removal of existingRemovals) {
    for (let index = removal.startIndex; index < removal.endIndexExclusive; index += 1) {
      removedOriginalIndexes.add(index)
    }
  }

  return {
    schemaVersion: 1,
    activeCompactBoundaryFingerprint: args.compactBoundaryFingerprint,
    removals: [
      ...existingRemovals,
      ...translateProjectedSnipRemovals({
        removals: args.newRemovals,
        removedOriginalIndexes,
      }),
    ],
  }
}

export function scopeDurableSnipStateToHistory(args: {
  state?: DurableSnipState | null
  history: PromptMessage[]
}): DurableSnipState | null {
  if (!args.state) return null
  const latestCompactBoundaryIndex = findLatestCompactBoundaryIndex(args.history)
  const activeCompactBoundaryFingerprint =
    latestCompactBoundaryIndex >= 0 ? fingerprintCompactBoundaryMessage(args.history[latestCompactBoundaryIndex]!) : null
  const stateFingerprint = args.state.activeCompactBoundaryFingerprint ?? null
  if (activeCompactBoundaryFingerprint !== stateFingerprint) {
    return {
      schemaVersion: 1,
      activeCompactBoundaryFingerprint,
      removals: [],
    }
  }
  return {
    schemaVersion: 1,
    activeCompactBoundaryFingerprint,
    removals: cloneDurableSnipRemovals(args.state.removals),
  }
}

export function buildContextProjection(args: {
  history: PromptMessage[]
  durableState?: ContextProjectionDurableInputState
}): ContextProjection {
  const latestCompactBoundaryIndex = findLatestCompactBoundaryIndex(args.history)
  const latestCompactBoundaryFingerprint =
    latestCompactBoundaryIndex >= 0 ? fingerprintCompactBoundaryMessage(args.history[latestCompactBoundaryIndex]!) : null
  const activeCompactBoundaryFingerprint =
    latestCompactBoundaryFingerprint ?? args.durableState?.collapse?.activeCompactBoundaryFingerprint ?? null
  const compactBoundaryBaseline = getContinuationMessagesAfterLatestCompactBoundary(args.history)
  const snipProjection = applyDurableSnipProjection({
    messages: compactBoundaryBaseline,
    state: args.durableState?.snip ?? null,
  })
  const collapseProjection = applyDurableCollapseProjection({
    messages: snipProjection.messages,
    snapshot: args.durableState?.collapse ?? null,
    compactBoundaryFingerprint: activeCompactBoundaryFingerprint,
  })
  const modelFacingBaseline = collapseProjection.messages
  const uiScrollback = buildUiScrollback(args.history)
  const durableState = buildDurableProjectionState({
    snip: snipProjection.fact,
    collapse: collapseProjection.fact,
  })

  return {
    rawTranscript: args.history,
    uiScrollback,
    modelFacingBaseline,
    diagnosticsProjection: modelFacingBaseline,
    durableState,
    facts: {
      latestCompactBoundary: findLatestCompactBoundary(args.history),
      activeCompactBoundaryFingerprint,
      rawTranscriptMessageCount: args.history.length,
      modelFacingBaselineMessageCount: modelFacingBaseline.length,
      modelFacingBaselineFingerprint: fingerprintPromptMessages(modelFacingBaseline),
      appliedDurableStages: [
        ...(snipProjection.fact.applied ? (['snip'] as const) : []),
        ...(collapseProjection.fact.applied ? (['collapse'] as const) : []),
      ],
    },
  }
}

function buildUiScrollback(history: PromptMessage[]): PromptMessage[] {
  let filtered: PromptMessage[] | null = null
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index]!
    if (readCompactBoundaryMeta(message)) {
      filtered ??= history.slice(0, index)
      continue
    }
    filtered?.push(message)
  }
  return filtered ?? history
}

function buildDurableProjectionState(args: {
  snip: DurableSnipProjectionFact
  collapse: DurableCollapseProjectionFact
}): ContextProjectionDurableState {
  return {
    snip: args.snip,
    collapse: args.collapse,
    toolResultContentReplacement: {
      stage: 'tool_result_content_replacement',
      status: 'deferred',
      applied: false,
      reason: 'Claude Code-style durable tool-result content replacement is deferred',
    },
  }
}

function applyDurableCollapseProjection(args: {
  messages: PromptMessage[]
  snapshot: ContextCollapseStoreSnapshot | null
  compactBoundaryFingerprint: string | null
}): { messages: PromptMessage[]; fact: DurableCollapseProjectionFact } {
  const snapshot = args.snapshot ? buildContextCollapseStoreSnapshot({ entries: args.snapshot.entries }) : null
  const snapshotEntries = snapshot?.entries ?? []
  const entries = args.compactBoundaryFingerprint
    ? snapshotEntries.filter((entry) => entry.compactBoundaryFingerprint === args.compactBoundaryFingerprint)
    : []
  if (entries.length === 0) {
    return {
      messages: args.messages,
      fact: {
        stage: 'collapse',
        status: 'no_state',
        applied: false,
        reason: 'no durable collapse state',
        committedEntryCount: snapshotEntries.length,
        replacedMessageCount: 0,
        droppedOrphanToolBlockCount: 0,
        compactBoundaryFingerprint: args.compactBoundaryFingerprint,
      },
    }
  }

  let messages = args.messages.slice()
  let appliedEntryCount = 0
  let replacedMessageCount = 0
  let droppedOrphanToolBlockCount = 0

  for (const entry of entries) {
    const normalized = normalizeCollapseEntryRange({ entry, messageCount: messages.length })
    if (!normalized) continue
    const replacedMessages = [
      ...messages.slice(0, normalized.startIndex),
      entry.recapMessage,
      ...messages.slice(normalized.endIndexExclusive),
    ]
    const relinked = dropOrphanToolBlocks(replacedMessages)
    messages = relinked.messages
    appliedEntryCount += 1
    replacedMessageCount += normalized.endIndexExclusive - normalized.startIndex
    droppedOrphanToolBlockCount += relinked.droppedOrphanToolBlockCount
  }

  if (appliedEntryCount === 0) {
    return {
      messages: args.messages,
      fact: {
        stage: 'collapse',
        status: 'no_state',
        applied: false,
        reason: 'durable collapse state removed no messages',
        committedEntryCount: entries.length,
        replacedMessageCount: 0,
        droppedOrphanToolBlockCount: 0,
        compactBoundaryFingerprint: args.compactBoundaryFingerprint,
      },
    }
  }

  return {
    messages,
    fact: {
      stage: 'collapse',
      status: 'active',
      applied: true,
      reason: 'applied durable collapse commits',
      committedEntryCount: appliedEntryCount,
      replacedMessageCount,
      droppedOrphanToolBlockCount,
      compactBoundaryFingerprint: args.compactBoundaryFingerprint,
    },
  }
}

function normalizeCollapseEntryRange(args: {
  entry: ContextCollapseCommittedEntry
  messageCount: number
}): { startIndex: number; endIndexExclusive: number } | null {
  const startIndex = Math.max(0, args.entry.collapsedRange.startIndex)
  const endIndexExclusive = Math.min(args.messageCount, args.entry.collapsedRange.endIndexExclusive)
  if (startIndex >= endIndexExclusive) return null
  return { startIndex, endIndexExclusive }
}

function applyDurableSnipProjection(args: {
  messages: PromptMessage[]
  state: DurableSnipState | null
}): { messages: PromptMessage[]; fact: DurableSnipProjectionFact } {
  const normalizedRemovals = normalizeDurableSnipRemovals({
    removals: args.state?.removals ?? [],
    messageCount: args.messages.length,
  })
  if (normalizedRemovals.length === 0) {
    return {
      messages: args.messages,
      fact: {
        stage: 'snip',
        status: 'no_state',
        applied: false,
        reason: 'no durable snip state',
        removedMessageCount: 0,
        droppedOrphanToolBlockCount: 0,
        removals: [],
      },
    }
  }

  const removedIndexes = new Set<number>()
  for (const removal of normalizedRemovals) {
    for (let index = removal.startIndex; index < removal.endIndexExclusive; index += 1) {
      removedIndexes.add(index)
    }
  }
  const messagesAfterRangeRemoval = args.messages.filter((_, index) => !removedIndexes.has(index))
  const relinked = dropOrphanToolBlocks(messagesAfterRangeRemoval)

  return {
    messages: relinked.messages,
    fact: {
      stage: 'snip',
      status: 'active',
      applied: removedIndexes.size > 0 || relinked.droppedOrphanToolBlockCount > 0,
      reason:
        removedIndexes.size > 0 || relinked.droppedOrphanToolBlockCount > 0
          ? 'applied durable snip removals'
          : 'durable snip state removed no messages',
      removedMessageCount: removedIndexes.size + relinked.droppedMessageCount,
      droppedOrphanToolBlockCount: relinked.droppedOrphanToolBlockCount,
      removals: normalizedRemovals,
    },
  }
}

function normalizeDurableSnipRemovals(args: {
  removals: DurableSnipRemoval[]
  messageCount: number
}): DurableSnipRemoval[] {
  const out: DurableSnipRemoval[] = []
  for (const removal of args.removals) {
    if (removal.kind !== 'model_facing_index_range') continue
    if (!Number.isInteger(removal.startIndex) || !Number.isInteger(removal.endIndexExclusive)) continue
    const startIndex = Math.max(0, removal.startIndex)
    const endIndexExclusive = Math.min(args.messageCount, removal.endIndexExclusive)
    if (startIndex >= endIndexExclusive) continue
    out.push({
      kind: 'model_facing_index_range',
      startIndex,
      endIndexExclusive,
      ...(removal.reason ? { reason: removal.reason } : {}),
      ...(Array.isArray(removal.removedMessageIds) ? { removedMessageIds: removal.removedMessageIds } : {}),
      ...(Array.isArray(removal.removedMessageFingerprints)
        ? { removedMessageFingerprints: removal.removedMessageFingerprints }
        : {}),
    })
  }
  return out
}

function cloneDurableSnipRemovals(removals: DurableSnipRemoval[]): DurableSnipRemoval[] {
  return removals.map((removal) => ({
    kind: 'model_facing_index_range',
    startIndex: removal.startIndex,
    endIndexExclusive: removal.endIndexExclusive,
    ...(removal.reason ? { reason: removal.reason } : {}),
    ...(Array.isArray(removal.removedMessageIds) ? { removedMessageIds: removal.removedMessageIds.slice() } : {}),
    ...(Array.isArray(removal.removedMessageFingerprints)
      ? { removedMessageFingerprints: removal.removedMessageFingerprints.slice() }
      : {}),
  }))
}

function translateProjectedSnipRemovals(args: {
  removals: DurableSnipRemoval[]
  removedOriginalIndexes: Set<number>
}): DurableSnipRemoval[] {
  const translated: DurableSnipRemoval[] = []
  for (const removal of args.removals) {
    const originalIndexes: number[] = []
    for (let index = removal.startIndex; index < removal.endIndexExclusive; index += 1) {
      originalIndexes.push(projectedIndexToOriginalIndex({
        projectedIndex: index,
        removedOriginalIndexes: args.removedOriginalIndexes,
      }))
    }
    translated.push(
      ...groupTranslatedSnipRemoval({
        removal,
        originalIndexes,
      }),
    )
  }
  return translated
}

function projectedIndexToOriginalIndex(args: {
  projectedIndex: number
  removedOriginalIndexes: Set<number>
}): number {
  let projectedCursor = 0
  for (let originalIndex = 0; originalIndex <= args.projectedIndex + args.removedOriginalIndexes.size; originalIndex += 1) {
    if (args.removedOriginalIndexes.has(originalIndex)) continue
    if (projectedCursor === args.projectedIndex) return originalIndex
    projectedCursor += 1
  }
  return args.projectedIndex + args.removedOriginalIndexes.size
}

function groupTranslatedSnipRemoval(args: {
  removal: DurableSnipRemoval
  originalIndexes: number[]
}): DurableSnipRemoval[] {
  if (args.originalIndexes.length === 0) return []
  const out: DurableSnipRemoval[] = []
  let groupStartOffset = 0
  while (groupStartOffset < args.originalIndexes.length) {
    let groupEndOffset = groupStartOffset + 1
    while (
      groupEndOffset < args.originalIndexes.length &&
      args.originalIndexes[groupEndOffset] === args.originalIndexes[groupEndOffset - 1]! + 1
    ) {
      groupEndOffset += 1
    }
    const startIndex = args.originalIndexes[groupStartOffset]!
    const endIndexExclusive = args.originalIndexes[groupEndOffset - 1]! + 1
    out.push({
      kind: 'model_facing_index_range',
      startIndex,
      endIndexExclusive,
      ...(args.removal.reason ? { reason: args.removal.reason } : {}),
      ...(Array.isArray(args.removal.removedMessageIds)
        ? { removedMessageIds: args.removal.removedMessageIds.slice(groupStartOffset, groupEndOffset) }
        : {}),
      ...(Array.isArray(args.removal.removedMessageFingerprints)
        ? {
            removedMessageFingerprints: args.removal.removedMessageFingerprints.slice(
              groupStartOffset,
              groupEndOffset,
            ),
          }
        : {}),
    })
    groupStartOffset = groupEndOffset
  }
  return out
}

function fingerprintPromptMessages(messages: PromptMessage[]): string {
  const digest = createHash('sha1')
  for (const message of messages) {
    digest.update(fingerprintPromptMessage(message))
    digest.update('\n')
  }
  return digest.digest('hex').slice(0, 16)
}
