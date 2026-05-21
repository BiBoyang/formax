import { createHash } from 'node:crypto'
import {
  findLatestCompactBoundary,
  fingerprintPromptMessage,
  getContinuationMessagesAfterLatestCompactBoundary,
  type CompactBoundaryMeta,
} from './compact'
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
}

export type DurableSnipState = {
  schemaVersion: 1
  removals: DurableSnipRemoval[]
}

export type DurableSnipProjectionFact = DurableProjectionStageFact & {
  stage: 'snip'
  status: 'no_state' | 'active'
  removedMessageCount: number
  removals: DurableSnipRemoval[]
}

export type ContextProjectionDurableState = {
  snip: DurableSnipProjectionFact
  collapse: DurableProjectionStageFact & { stage: 'collapse'; status: 'no_state' }
  toolResultContentReplacement: DurableProjectionStageFact & {
    stage: 'tool_result_content_replacement'
    status: 'deferred'
  }
}

export type ContextProjectionDurableInputState = {
  snip?: DurableSnipState | null
  collapse?: null
  toolResultContentReplacement?: null
}

export type ContextProjectionFacts = {
  latestCompactBoundary: CompactBoundaryMeta | null
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

export function buildContextProjection(args: {
  history: PromptMessage[]
  durableState?: ContextProjectionDurableInputState
}): ContextProjection {
  const compactBoundaryBaseline = getContinuationMessagesAfterLatestCompactBoundary(args.history)
  const snipProjection = applyDurableSnipProjection({
    messages: compactBoundaryBaseline,
    state: args.durableState?.snip ?? null,
  })
  const modelFacingBaseline = snipProjection.messages
  const durableState = buildDurableProjectionState({ snip: snipProjection.fact })

  return {
    rawTranscript: args.history,
    uiScrollback: args.history,
    modelFacingBaseline,
    diagnosticsProjection: modelFacingBaseline,
    durableState,
    facts: {
      latestCompactBoundary: findLatestCompactBoundary(args.history),
      rawTranscriptMessageCount: args.history.length,
      modelFacingBaselineMessageCount: modelFacingBaseline.length,
      modelFacingBaselineFingerprint: fingerprintPromptMessages(modelFacingBaseline),
      appliedDurableStages: snipProjection.fact.applied ? ['snip'] : [],
    },
  }
}

function buildDurableProjectionState(args: { snip: DurableSnipProjectionFact }): ContextProjectionDurableState {
  return {
    snip: args.snip,
    collapse: {
      stage: 'collapse',
      status: 'no_state',
      applied: false,
      reason: 'durable collapse projection is not implemented yet',
    },
    toolResultContentReplacement: {
      stage: 'tool_result_content_replacement',
      status: 'deferred',
      applied: false,
      reason: 'Claude Code-style durable tool-result content replacement is deferred',
    },
  }
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
  const messages = args.messages.filter((_, index) => !removedIndexes.has(index))

  return {
    messages,
    fact: {
      stage: 'snip',
      status: 'active',
      applied: removedIndexes.size > 0,
      reason: removedIndexes.size > 0 ? 'applied durable snip removals' : 'durable snip state removed no messages',
      removedMessageCount: removedIndexes.size,
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
    })
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
