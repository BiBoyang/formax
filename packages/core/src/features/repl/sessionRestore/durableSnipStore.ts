import {
  findLatestCompactBoundaryIndex,
  fingerprintCompactBoundaryMessage,
  type PromptMessageIdentity,
} from '../../../chat/context/compact'
import type { DurableSnipRemoval, DurableSnipState } from '../../../chat/context/contextProjection'
import type { PromptMessage } from '../../../prompts'
import {
  readDurableSnipSessionRecordsFromSession,
  readDurableSnipSessionRecordsFromSessionSync,
  type DurableSnipCommittedEventDto,
  type DurableSnipRemovalDto,
  type DurableSnipSessionRecordDto,
} from '../sessionSave/durableSnipStoreEvents'

function readActiveCompactBoundaryFingerprint(record: DurableSnipSessionRecordDto): string | null | undefined {
  if (record.type !== 'history_state') return undefined
  const messages = record.messages as PromptMessage[]
  const boundaryIndex = findLatestCompactBoundaryIndex(messages)
  if (boundaryIndex < 0) return undefined
  return fingerprintCompactBoundaryMessage(messages[boundaryIndex]!)
}

function applyActiveCompactBoundaryFingerprint(args: {
  state: DurableSnipState
  activeCompactBoundaryFingerprint: string | null
}): DurableSnipState {
  if (
    args.activeCompactBoundaryFingerprint &&
    args.state.removals.length > 0 &&
    args.state.activeCompactBoundaryFingerprint !== args.activeCompactBoundaryFingerprint
  ) {
    return {
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: args.activeCompactBoundaryFingerprint,
      baseProjectionFingerprint: args.state.baseProjectionFingerprint ?? null,
      sourceProjectionKind: args.state.sourceProjectionKind ?? null,
      removals: [],
    }
  }
  return {
    ...args.state,
    activeCompactBoundaryFingerprint: args.activeCompactBoundaryFingerprint,
  }
}

function toDurableSnipRemoval(dto: DurableSnipRemovalDto): DurableSnipRemoval {
  return {
    ...dto,
    ...(dto.removedMessageIdentities
      ? { removedMessageIdentities: dto.removedMessageIdentities as PromptMessageIdentity[] }
      : {}),
  }
}

function applyDurableSnipEvent(args: {
  state: DurableSnipState
  event: DurableSnipCommittedEventDto
}): DurableSnipState {
  const eventCompactBoundaryFingerprint = args.event.compactBoundaryFingerprint
  if (
    eventCompactBoundaryFingerprint &&
    args.state.activeCompactBoundaryFingerprint &&
    eventCompactBoundaryFingerprint !== args.state.activeCompactBoundaryFingerprint
  ) {
    return args.state
  }
  if (!eventCompactBoundaryFingerprint && args.state.activeCompactBoundaryFingerprint) return args.state
  const sourceProjectionKind =
    args.event.sourceProjectionKind === 'model_facing_baseline' ? args.event.sourceProjectionKind : null
  return {
    schemaVersion: 1,
    activeCompactBoundaryFingerprint: args.state.activeCompactBoundaryFingerprint ?? eventCompactBoundaryFingerprint,
    baseProjectionFingerprint: args.event.baseProjectionFingerprint,
    sourceProjectionKind,
    removals: args.event.removals.map(toDurableSnipRemoval),
  }
}

export function buildDurableSnipStateFromSessionRecords(
  records: DurableSnipSessionRecordDto[],
): DurableSnipState {
  let state: DurableSnipState = { schemaVersion: 1, activeCompactBoundaryFingerprint: null, removals: [] }

  for (const record of records) {
    const nextActiveCompactBoundaryFingerprint = readActiveCompactBoundaryFingerprint(record)
    if (nextActiveCompactBoundaryFingerprint !== undefined) {
      state = applyActiveCompactBoundaryFingerprint({
        state,
        activeCompactBoundaryFingerprint: nextActiveCompactBoundaryFingerprint,
      })
    }
    if (record.type !== 'durable_snip_applied') continue
    state = applyDurableSnipEvent({ state, event: record })
  }

  return state
}

export async function readDurableSnipStateFromSession(args: { filePath: string }): Promise<DurableSnipState> {
  return buildDurableSnipStateFromSessionRecords(await readDurableSnipSessionRecordsFromSession(args))
}

export function readDurableSnipStateFromSessionSync(args: { filePath: string }): DurableSnipState {
  return buildDurableSnipStateFromSessionRecords(readDurableSnipSessionRecordsFromSessionSync(args))
}
