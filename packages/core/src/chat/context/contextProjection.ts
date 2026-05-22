import { createHash } from 'node:crypto'
import {
  findLatestCompactBoundary,
  findLatestCompactBoundaryIndex,
  buildPromptMessageIdentity,
  fingerprintCompactBoundaryMessage,
  fingerprintPromptMessage,
  getContinuationMessagesAfterLatestCompactBoundary,
  readCompactBoundaryMeta,
  readPromptMessageIdentity,
  type CompactBoundaryMeta,
  type PromptMessageIdentity,
} from './compact'
import {
  buildContextCollapseStoreSnapshot,
  type ContextCollapseCommittedEntry,
  type ContextCollapseStoreSnapshot,
} from './contextCollapseStore'
import { dropOrphanToolBlocks } from './toolPairProjection'
import type { PromptMessage } from '../../prompts'
import { toolResultContentToText } from '../../shared/utils/toolResultContent'

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
  removedMessageIdentities?: PromptMessageIdentity[]
}

export type DurableSnipSourceProjectionKind = 'model_facing_baseline'

export type DurableSnipState = {
  schemaVersion: 1
  activeCompactBoundaryFingerprint?: string | null
  baseProjectionFingerprint?: string | null
  sourceProjectionKind?: DurableSnipSourceProjectionKind | null
  removals: DurableSnipRemoval[]
}

export type DurableToolResultContentReplacementSourceScope =
  | { kind: 'main_thread' }
  | { kind: 'sidechain'; id: string }

export type DurableToolResultContentReplacement = {
  kind: 'tool_result_block'
  toolUseId: string
  replacementContent: string
  originalContentFingerprint?: string
  reason?: string
}

export type DurableToolResultContentReplacementState = {
  schemaVersion: 1
  sourceScope: DurableToolResultContentReplacementSourceScope
  activeCompactBoundaryFingerprint?: string | null
  baseProjectionFingerprint?: string | null
  sourceProjectionKind?: DurableSnipSourceProjectionKind | null
  replacements: DurableToolResultContentReplacement[]
}

export function rebaseCollapseHeadCountAfterDurableSnip(args: {
  collapsedHeadMessageCount: number
  snipRemovals: DurableSnipRemoval[]
  baselineMessages?: PromptMessage[]
}): number | null {
  const collapsedHeadMessageCount = Math.max(0, Math.floor(args.collapsedHeadMessageCount))
  const snipRemovals = normalizeDurableSnipRemovals({
    removals: args.snipRemovals,
    messageCount: args.baselineMessages?.length ?? Number.MAX_SAFE_INTEGER,
  })
  if (args.baselineMessages) {
    const requestedRangeRemovalCount = args.snipRemovals.filter(
      (removal) => removal.kind === 'model_facing_index_range',
    ).length
    if (snipRemovals.length !== requestedRangeRemovalCount) return null
    const identityCounts = countExplicitMessageIdentities(args.baselineMessages)
    const fingerprintCounts = countMessageFingerprints(args.baselineMessages)
    for (const removal of snipRemovals) {
      const validation = validateDurableSnipRemoval({
        removal,
        messages: args.baselineMessages,
        identityCounts,
        fingerprintCounts,
      })
      if (!validation.ok) return null
    }
  }
  const removedCollapsedHeadIndexes = new Set<number>()
  for (const removal of snipRemovals) {
    if (removal.endIndexExclusive <= collapsedHeadMessageCount) {
      for (let index = removal.startIndex; index < removal.endIndexExclusive; index += 1) {
        removedCollapsedHeadIndexes.add(index)
      }
      continue
    }
    if (removal.startIndex < collapsedHeadMessageCount && removal.endIndexExclusive > collapsedHeadMessageCount) {
      return null
    }
  }
  const adjustedCount = collapsedHeadMessageCount - removedCollapsedHeadIndexes.size
  return adjustedCount > 0 ? adjustedCount : null
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

export type DurableToolResultContentReplacementProjectionFact = DurableProjectionStageFact & {
  stage: 'tool_result_content_replacement'
  status: 'no_state' | 'active'
  replacementCount: number
  skippedReplacementCount: number
  replacements: DurableToolResultContentReplacement[]
}

export type ContextProjectionDurableState = {
  snip: DurableSnipProjectionFact
  collapse: DurableCollapseProjectionFact
  toolResultContentReplacement: DurableToolResultContentReplacementProjectionFact
}

export type ContextProjectionDurableInputState = {
  snip?: DurableSnipState | null
  collapse?: ContextCollapseStoreSnapshot | null
  toolResultContentReplacement?: DurableToolResultContentReplacementState | null
}

export type ContextProjectionFacts = {
  latestCompactBoundary: CompactBoundaryMeta | null
  activeCompactBoundaryFingerprint: string | null
  rawTranscriptMessageCount: number
  modelFacingBaselineMessageCount: number
  modelFacingBaselineFingerprint: string
  modelFacingBaselineMessageIdentities: ReturnType<typeof buildPromptMessageIdentity>[]
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
  appliedExistingRemovals?: DurableSnipRemoval[]
  newRemovals: DurableSnipRemoval[]
  compactBoundaryFingerprint: string | null
  baseProjectionFingerprint?: string | null
  sourceProjectionKind?: DurableSnipSourceProjectionKind | null
}): DurableSnipState {
  const existingFingerprint = args.existingState?.activeCompactBoundaryFingerprint ?? null
  const shouldCarryExisting = args.compactBoundaryFingerprint
    ? existingFingerprint === args.compactBoundaryFingerprint
    : existingFingerprint === null
  const existingRemovals = shouldCarryExisting
    ? cloneDurableSnipRemovals(args.appliedExistingRemovals ?? args.existingState?.removals ?? [])
    : []
  const baseProjectionFingerprint = args.baseProjectionFingerprint ?? args.existingState?.baseProjectionFingerprint ?? null
  const sourceProjectionKind = args.sourceProjectionKind ?? args.existingState?.sourceProjectionKind ?? null
  if (existingRemovals.length === 0) {
    return {
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: args.compactBoundaryFingerprint,
      ...(baseProjectionFingerprint ? { baseProjectionFingerprint } : {}),
      ...(sourceProjectionKind ? { sourceProjectionKind } : {}),
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
    ...(baseProjectionFingerprint ? { baseProjectionFingerprint } : {}),
    ...(sourceProjectionKind ? { sourceProjectionKind } : {}),
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
  const observedCompactBoundaryFingerprint =
    latestCompactBoundaryIndex >= 0 ? fingerprintCompactBoundaryMessage(args.history[latestCompactBoundaryIndex]!) : null
  const stateFingerprint = args.state.activeCompactBoundaryFingerprint ?? null
  const activeCompactBoundaryFingerprint =
    observedCompactBoundaryFingerprint ?? (stateFingerprint ? stateFingerprint : null)
  if (observedCompactBoundaryFingerprint && observedCompactBoundaryFingerprint !== stateFingerprint) {
    return {
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: observedCompactBoundaryFingerprint,
      ...(args.state.baseProjectionFingerprint ? { baseProjectionFingerprint: args.state.baseProjectionFingerprint } : {}),
      ...(args.state.sourceProjectionKind ? { sourceProjectionKind: args.state.sourceProjectionKind } : {}),
      removals: [],
    }
  }
  return {
    schemaVersion: 1,
    activeCompactBoundaryFingerprint,
    ...(args.state.baseProjectionFingerprint ? { baseProjectionFingerprint: args.state.baseProjectionFingerprint } : {}),
    ...(args.state.sourceProjectionKind ? { sourceProjectionKind: args.state.sourceProjectionKind } : {}),
    removals: cloneDurableSnipRemovals(args.state.removals),
  }
}

export function scopeDurableToolResultContentReplacementStateToHistory(args: {
  state?: DurableToolResultContentReplacementState | null
  history: PromptMessage[]
}): DurableToolResultContentReplacementState | null {
  if (!args.state) return null
  const latestCompactBoundaryIndex = findLatestCompactBoundaryIndex(args.history)
  const observedCompactBoundaryFingerprint =
    latestCompactBoundaryIndex >= 0 ? fingerprintCompactBoundaryMessage(args.history[latestCompactBoundaryIndex]!) : null
  const stateFingerprint = args.state.activeCompactBoundaryFingerprint ?? null
  const activeCompactBoundaryFingerprint =
    observedCompactBoundaryFingerprint ?? (stateFingerprint ? stateFingerprint : null)
  if (observedCompactBoundaryFingerprint && observedCompactBoundaryFingerprint !== stateFingerprint) {
    return {
      schemaVersion: 1,
      sourceScope: args.state.sourceScope,
      activeCompactBoundaryFingerprint: observedCompactBoundaryFingerprint,
      ...(args.state.baseProjectionFingerprint ? { baseProjectionFingerprint: args.state.baseProjectionFingerprint } : {}),
      ...(args.state.sourceProjectionKind ? { sourceProjectionKind: args.state.sourceProjectionKind } : {}),
      replacements: [],
    }
  }
  return {
    schemaVersion: 1,
    sourceScope: args.state.sourceScope,
    activeCompactBoundaryFingerprint,
    ...(args.state.baseProjectionFingerprint ? { baseProjectionFingerprint: args.state.baseProjectionFingerprint } : {}),
    ...(args.state.sourceProjectionKind ? { sourceProjectionKind: args.state.sourceProjectionKind } : {}),
    replacements: cloneDurableToolResultContentReplacements(args.state.replacements),
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
  const toolResultContentReplacementProjection = applyDurableToolResultContentReplacementProjection({
    messages: collapseProjection.messages,
    state: args.durableState?.toolResultContentReplacement ?? null,
  })
  const modelFacingBaseline = toolResultContentReplacementProjection.messages
  const uiScrollback = buildUiScrollback(args.history)
  const durableState = buildDurableProjectionState({
    snip: snipProjection.fact,
    collapse: collapseProjection.fact,
    toolResultContentReplacement: toolResultContentReplacementProjection.fact,
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
      modelFacingBaselineMessageIdentities: modelFacingBaseline.map((message, index) =>
        buildPromptMessageIdentity({ message, index }),
      ),
      appliedDurableStages: [
        ...(snipProjection.fact.applied ? (['snip'] as const) : []),
        ...(collapseProjection.fact.applied ? (['collapse'] as const) : []),
        ...(toolResultContentReplacementProjection.fact.applied
          ? (['tool_result_content_replacement'] as const)
          : []),
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
  toolResultContentReplacement: DurableToolResultContentReplacementProjectionFact
}): ContextProjectionDurableState {
  return {
    snip: args.snip,
    collapse: args.collapse,
    toolResultContentReplacement: args.toolResultContentReplacement,
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

function applyDurableToolResultContentReplacementProjection(args: {
  messages: PromptMessage[]
  state: DurableToolResultContentReplacementState | null
}): { messages: PromptMessage[]; fact: DurableToolResultContentReplacementProjectionFact } {
  const replacements = cloneDurableToolResultContentReplacements(args.state?.replacements ?? [])
  if (replacements.length === 0) {
    return {
      messages: args.messages,
      fact: {
        stage: 'tool_result_content_replacement',
        status: 'no_state',
        applied: false,
        reason: 'no durable tool-result content replacement state',
        replacementCount: 0,
        skippedReplacementCount: 0,
        replacements: [],
      },
    }
  }

  const nextMessages = args.messages.slice()
  const patchedByMessageIndex = new Map<number, PromptMessage>()
  const appliedReplacements: DurableToolResultContentReplacement[] = []
  let skippedReplacementCount = 0
  for (const replacement of replacements) {
    const matches = findToolResultBlocksByToolUseId({
      messages: nextMessages,
      toolUseId: replacement.toolUseId,
    })
    if (matches.length !== 1) {
      skippedReplacementCount += 1
      continue
    }
    const match = matches[0]!
    const sourceMessage = patchedByMessageIndex.get(match.messageIndex) ?? nextMessages[match.messageIndex]
    if (!sourceMessage || !Array.isArray(sourceMessage.content)) {
      skippedReplacementCount += 1
      continue
    }
    const currentBlock = (sourceMessage.content as any[])[match.blockIndex]
    if (!currentBlock || currentBlock.type !== 'tool_result') {
      skippedReplacementCount += 1
      continue
    }
    if (
      replacement.originalContentFingerprint &&
      replacement.originalContentFingerprint !== fingerprintToolResultContent(currentBlock.content)
    ) {
      skippedReplacementCount += 1
      continue
    }
    const nextBlocks = [...(sourceMessage.content as any[])]
    nextBlocks[match.blockIndex] = {
      ...currentBlock,
      content: replacement.replacementContent,
    }
    const previousReplacementIds = Array.isArray((sourceMessage.meta as any)?.durableToolResultContentReplacementToolUseIds)
      ? ((sourceMessage.meta as any).durableToolResultContentReplacementToolUseIds as unknown[])
          .filter((value): value is string => typeof value === 'string')
      : []
    const patchedMessage = {
      ...sourceMessage,
      meta: {
        ...(sourceMessage.meta ?? {}),
        durableToolResultContentReplacementToolUseIds: Array.from(new Set([
          ...previousReplacementIds,
          replacement.toolUseId,
        ])),
      },
      content: nextBlocks as any,
    }
    patchedByMessageIndex.set(match.messageIndex, patchedMessage)
    nextMessages[match.messageIndex] = patchedMessage
    appliedReplacements.push(replacement)
  }

  return {
    messages: nextMessages,
    fact: {
      stage: 'tool_result_content_replacement',
      status: appliedReplacements.length > 0 ? 'active' : 'no_state',
      applied: appliedReplacements.length > 0,
      reason:
        appliedReplacements.length > 0
          ? skippedReplacementCount > 0
            ? 'applied durable tool-result content replacements with skipped drifted replacements'
            : 'applied durable tool-result content replacements'
          : 'skipped durable tool-result content replacements due to drift or missing tool results',
      replacementCount: appliedReplacements.length,
      skippedReplacementCount,
      replacements: appliedReplacements,
    },
  }
}

function findToolResultBlocksByToolUseId(args: {
  messages: PromptMessage[]
  toolUseId: string
}): Array<{ messageIndex: number; blockIndex: number }> {
  const out: Array<{ messageIndex: number; blockIndex: number }> = []
  for (let messageIndex = 0; messageIndex < args.messages.length; messageIndex += 1) {
    const message = args.messages[messageIndex]
    if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue
    for (let blockIndex = 0; blockIndex < (message.content as any[]).length; blockIndex += 1) {
      const block = (message.content as any[])[blockIndex]
      if (block?.type === 'tool_result' && block.tool_use_id === args.toolUseId) {
        out.push({ messageIndex, blockIndex })
      }
    }
  }
  return out
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
  const appliedRemovals: DurableSnipRemoval[] = []
  let skippedRemovalCount = 0
  const identityCounts = countExplicitMessageIdentities(args.messages)
  const fingerprintCounts = countMessageFingerprints(args.messages)
  for (const removal of normalizedRemovals) {
    const validation = validateDurableSnipRemoval({
      removal,
      messages: args.messages,
      identityCounts,
      fingerprintCounts,
    })
    if (!validation.ok) {
      skippedRemovalCount += 1
      continue
    }
    appliedRemovals.push(removal)
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
          ? skippedRemovalCount > 0
            ? 'applied durable snip removals with skipped drifted removals'
            : 'applied durable snip removals'
          : skippedRemovalCount > 0
            ? 'skipped durable snip removals due to identity/fingerprint drift'
            : 'durable snip state removed no messages',
      removedMessageCount: removedIndexes.size + relinked.droppedMessageCount,
      droppedOrphanToolBlockCount: relinked.droppedOrphanToolBlockCount,
      removals: appliedRemovals,
    },
  }
}

function countExplicitMessageIdentities(messages: PromptMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    const identity = readPromptMessageIdentity(message)
    if (!identity || identity.source !== 'explicit') continue
    counts.set(identity.id, (counts.get(identity.id) ?? 0) + 1)
  }
  return counts
}

function countMessageFingerprints(messages: PromptMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    const fingerprint = fingerprintPromptMessage(message)
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1)
  }
  return counts
}

function validateDurableSnipRemoval(args: {
  removal: DurableSnipRemoval
  messages: PromptMessage[]
  identityCounts: Map<string, number>
  fingerprintCounts: Map<string, number>
}): { ok: true } | { ok: false; reason: string } {
  const expectedCount = args.removal.endIndexExclusive - args.removal.startIndex
  const identities = args.removal.removedMessageIdentities
  const hasExplicitIdentityGuard =
    Array.isArray(identities) && identities.length > 0 && identities.every((identity) => identity.source === 'explicit')
  if (hasExplicitIdentityGuard) {
    if (identities.length !== expectedCount) return { ok: false, reason: 'identity_count_mismatch' }
    for (let offset = 0; offset < identities.length; offset += 1) {
      const expected = identities[offset]!
      if ((args.identityCounts.get(expected.id) ?? 0) !== 1) return { ok: false, reason: 'identity_not_unique' }
      const target = args.messages[args.removal.startIndex + offset]
      const actual = readPromptMessageIdentity(target)
      if (!actual || actual.source !== 'explicit') return { ok: false, reason: 'missing_identity' }
      if (actual.id !== expected.id) return { ok: false, reason: 'identity_mismatch' }
      if (expected.fingerprint !== fingerprintPromptMessage(target!)) {
        return { ok: false, reason: 'identity_fingerprint_mismatch' }
      }
    }
    return { ok: true }
  }

  const fingerprints = args.removal.removedMessageFingerprints
  if (!Array.isArray(fingerprints) || fingerprints.length === 0) {
    return { ok: false, reason: 'missing_legacy_fingerprint_guard' }
  }
  if (fingerprints.length !== expectedCount) return { ok: false, reason: 'fingerprint_count_mismatch' }
  for (let offset = 0; offset < fingerprints.length; offset += 1) {
    const expected = fingerprints[offset]!
    if ((args.fingerprintCounts.get(expected) ?? 0) !== 1) return { ok: false, reason: 'fingerprint_not_unique' }
    const target = args.messages[args.removal.startIndex + offset]
    if (!target || fingerprintPromptMessage(target) !== expected) return { ok: false, reason: 'fingerprint_mismatch' }
  }
  return { ok: true }
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
      ...(Array.isArray(removal.removedMessageIdentities)
        ? { removedMessageIdentities: removal.removedMessageIdentities.map(clonePromptMessageIdentity) }
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
    ...(Array.isArray(removal.removedMessageIdentities)
      ? { removedMessageIdentities: removal.removedMessageIdentities.map(clonePromptMessageIdentity) }
      : {}),
  }))
}

function cloneDurableToolResultContentReplacements(
  replacements: DurableToolResultContentReplacement[],
): DurableToolResultContentReplacement[] {
  return replacements.map((replacement) => ({
    kind: 'tool_result_block',
    toolUseId: replacement.toolUseId,
    replacementContent: replacement.replacementContent,
    ...(replacement.originalContentFingerprint
      ? { originalContentFingerprint: replacement.originalContentFingerprint }
      : {}),
    ...(replacement.reason ? { reason: replacement.reason } : {}),
  }))
}

function clonePromptMessageIdentity(identity: PromptMessageIdentity): PromptMessageIdentity {
  return {
    schemaVersion: 1,
    id: identity.id,
    parentId: identity.parentId ?? null,
    fingerprint: identity.fingerprint,
    source: identity.source,
  }
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
      ...(Array.isArray(args.removal.removedMessageIdentities)
        ? {
            removedMessageIdentities: args.removal.removedMessageIdentities
              .slice(groupStartOffset, groupEndOffset)
              .map(clonePromptMessageIdentity),
          }
        : {}),
    })
    groupStartOffset = groupEndOffset
  }
  return out
}

export function fingerprintToolResultContent(content: unknown): string {
  return createHash('sha1')
    .update(toolResultContentToText(content as any))
    .digest('hex')
    .slice(0, 16)
}

function fingerprintPromptMessages(messages: PromptMessage[]): string {
  const digest = createHash('sha1')
  for (const message of messages) {
    digest.update(fingerprintPromptMessage(message))
    digest.update('\n')
  }
  return digest.digest('hex').slice(0, 16)
}
