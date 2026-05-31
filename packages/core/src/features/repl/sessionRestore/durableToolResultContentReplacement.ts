import {
  findLatestCompactBoundaryIndex,
  fingerprintCompactBoundaryMessage,
} from '../../../chat/context/compact'
import type {
  DurableToolResultContentReplacement,
  DurableToolResultContentReplacementSourceScope,
  DurableToolResultContentReplacementState,
} from '../../../chat/context/contextProjection'
import type { PromptMessage } from '../../../prompts'
import {
  readDurableToolResultContentReplacementSessionRecordsFromSession,
  readDurableToolResultContentReplacementSessionRecordsFromSessionSync,
  type DurableToolResultContentReplacementEventDto,
  type DurableToolResultContentReplacementSessionRecordDto,
  type DurableToolResultContentReplacementSourceScopeDto,
} from '../sessionSave/durableToolResultContentReplacementEvents'

const MAIN_THREAD_SCOPE: DurableToolResultContentReplacementSourceScope = { kind: 'main_thread' }

function toSourceScope(
  dto: DurableToolResultContentReplacementSourceScopeDto | undefined,
): DurableToolResultContentReplacementSourceScope {
  return dto ?? MAIN_THREAD_SCOPE
}

function sameSourceScope(
  left: DurableToolResultContentReplacementSourceScope,
  right: DurableToolResultContentReplacementSourceScope,
): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'main_thread') return true
  return left.id === (right as { kind: 'sidechain'; id: string }).id
}

function readActiveCompactBoundaryFingerprint(
  record: DurableToolResultContentReplacementSessionRecordDto,
): string | null | undefined {
  if (record.type !== 'history_state') return undefined
  const messages = record.messages as PromptMessage[]
  const boundaryIndex = findLatestCompactBoundaryIndex(messages)
  if (boundaryIndex < 0) return undefined
  return fingerprintCompactBoundaryMessage(messages[boundaryIndex]!)
}

function emptyState(scope: DurableToolResultContentReplacementSourceScope): DurableToolResultContentReplacementState {
  return {
    schemaVersion: 1,
    sourceScope: scope,
    activeCompactBoundaryFingerprint: null,
    replacements: [],
  }
}

function applyActiveCompactBoundaryFingerprint(args: {
  state: DurableToolResultContentReplacementState
  activeCompactBoundaryFingerprint: string | null
}): DurableToolResultContentReplacementState {
  if (
    args.activeCompactBoundaryFingerprint &&
    args.state.replacements.length > 0 &&
    args.state.activeCompactBoundaryFingerprint !== args.activeCompactBoundaryFingerprint
  ) {
    return {
      schemaVersion: 1,
      sourceScope: args.state.sourceScope,
      activeCompactBoundaryFingerprint: args.activeCompactBoundaryFingerprint,
      ...(args.state.baseProjectionFingerprint ? { baseProjectionFingerprint: args.state.baseProjectionFingerprint } : {}),
      ...(args.state.sourceProjectionKind ? { sourceProjectionKind: args.state.sourceProjectionKind } : {}),
      replacements: [],
    }
  }
  return {
    ...args.state,
    activeCompactBoundaryFingerprint: args.activeCompactBoundaryFingerprint,
  }
}

function toReplacement(
  dto: DurableToolResultContentReplacementEventDto['replacements'][number],
): DurableToolResultContentReplacement {
  return { ...dto }
}

function applyDurableToolResultReplacementEvent(args: {
  state: DurableToolResultContentReplacementState
  event: DurableToolResultContentReplacementEventDto
  sourceScope: DurableToolResultContentReplacementSourceScope
}): DurableToolResultContentReplacementState {
  const eventSourceScope = toSourceScope(args.event.sourceScope)
  if (!sameSourceScope(eventSourceScope, args.sourceScope)) return args.state
  const eventCompactBoundaryFingerprint = args.event.compactBoundaryFingerprint
  if (
    eventCompactBoundaryFingerprint &&
    args.state.activeCompactBoundaryFingerprint &&
    eventCompactBoundaryFingerprint !== args.state.activeCompactBoundaryFingerprint
  ) {
    return args.state
  }
  if (!eventCompactBoundaryFingerprint && args.state.activeCompactBoundaryFingerprint) return args.state
  if (args.event.sourceProjectionKind !== undefined && args.event.sourceProjectionKind !== 'model_facing_baseline') {
    return args.state
  }
  const sourceProjectionKind =
    args.event.sourceProjectionKind === 'model_facing_baseline' ? args.event.sourceProjectionKind : null
  return {
    schemaVersion: 1,
    sourceScope: eventSourceScope,
    activeCompactBoundaryFingerprint: args.state.activeCompactBoundaryFingerprint ?? eventCompactBoundaryFingerprint,
    baseProjectionFingerprint: args.event.baseProjectionFingerprint,
    sourceProjectionKind,
    replacements: args.event.replacements.map(toReplacement),
  }
}

export function buildDurableToolResultContentReplacementStateFromSessionRecords(args: {
  records: DurableToolResultContentReplacementSessionRecordDto[]
  sourceScope?: DurableToolResultContentReplacementSourceScope
}): DurableToolResultContentReplacementState {
  const sourceScope = args.sourceScope ?? MAIN_THREAD_SCOPE
  let state = emptyState(sourceScope)

  for (const record of args.records) {
    const nextActiveCompactBoundaryFingerprint = readActiveCompactBoundaryFingerprint(record)
    if (nextActiveCompactBoundaryFingerprint !== undefined) {
      state = applyActiveCompactBoundaryFingerprint({
        state,
        activeCompactBoundaryFingerprint: nextActiveCompactBoundaryFingerprint,
      })
    }
    if (record.type !== 'durable_tool_result_content_replacement_applied') continue
    state = applyDurableToolResultReplacementEvent({ state, event: record, sourceScope })
  }

  return state
}

export async function readDurableToolResultContentReplacementStateFromSession(args: {
  filePath: string
  sourceScope?: DurableToolResultContentReplacementSourceScope
}): Promise<DurableToolResultContentReplacementState> {
  const records = await readDurableToolResultContentReplacementSessionRecordsFromSession({ filePath: args.filePath })
  return buildDurableToolResultContentReplacementStateFromSessionRecords({
    records,
    sourceScope: args.sourceScope,
  })
}

export function readDurableToolResultContentReplacementStateFromSessionSync(args: {
  filePath: string
  sourceScope?: DurableToolResultContentReplacementSourceScope
}): DurableToolResultContentReplacementState {
  return buildDurableToolResultContentReplacementStateFromSessionRecords({
    records: readDurableToolResultContentReplacementSessionRecordsFromSessionSync({ filePath: args.filePath }),
    sourceScope: args.sourceScope,
  })
}
