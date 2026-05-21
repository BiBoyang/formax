import { getClaudeMdInjectionMeta } from '../../injectedBlocks'
import { getLocalCommandInjectionStats } from './localCommandInjection'
import type { LocalCommandRecord } from '../../../commands/registry'
import type { SessionWriter } from '../../sessionSave/writer'
import {
  CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME,
  createContextCollapseCommittedEntry,
  type ContextCollapseCommittedEntry,
  type ContextCollapseCommitState,
} from '../../../../chat/context/contextCollapseStore'
import type { ContextCollapseMeta } from '../../../../chat/context/contextCollapse'
import type { DurableSnipRemoval } from '../../../../chat/context/contextProjection'
import type { ReactiveCompactErrorKind } from '../shared/reactiveCompactTypes'
import { DURABLE_SNIP_COMMITTED_EVENT_NAME } from '../../sessionSave/durableSnipStoreEvents'

type RequestSnipEventState = {
  applied: boolean
  removedMessageCount: number
  estimatedTokensSaved: number
  compactBoundaryFingerprint: string | null
  baseProjectionFingerprint: string | null
  sourceProjectionKind: 'model_facing_baseline'
  removals: DurableSnipRemoval[]
}

type SessionEventWriter = Pick<SessionWriter, 'appendEvent'> | null

export function recordCompactRequestedEvent(args: {
  sessionSaveEnabled: boolean
  writer: SessionEventWriter
}): void {
  if (!args.sessionSaveEnabled) return
  void args.writer?.appendEvent('compact_requested')
}

export function recordLocalCommandInjectionEvent(args: {
  sessionSaveEnabled: boolean
  writer: SessionEventWriter
  source: 'slash_local' | 'slash_local_async'
  record: LocalCommandRecord
}): void {
  if (!args.sessionSaveEnabled) return
  const stats = getLocalCommandInjectionStats(args.record)
  void args.writer?.appendEvent('local_command_injection', {
    source: args.source,
    commandName: args.record.commandName,
    ...stats,
  })
}

export function recordClaudeMdInjectionEvent(args: {
  sessionSaveEnabled: boolean
  cwd: string
  env: NodeJS.ProcessEnv
  includeAutoMemory?: boolean
  lastSigRef: { current: string | null }
  writer: SessionEventWriter
}): void {
  if (!args.sessionSaveEnabled) return

  const meta = getClaudeMdInjectionMeta({
    cwd: args.cwd,
    env: args.env,
    includeAutoMemory: args.includeAutoMemory,
  })
  if (!meta.global && !meta.project && !meta.memory) return

  const sig = JSON.stringify(meta)
  if (args.lastSigRef.current === sig) return

  args.lastSigRef.current = sig
  void args.writer?.appendEvent('claude_md_injection', meta)
}

export async function recordRequestCollapseEvent(args: {
  sessionSaveEnabled: boolean
  writer: SessionEventWriter
  phase: 'initial' | 'reactive_retry'
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  metadata: ContextCollapseMeta | null
  commit: ContextCollapseCommitState | null
}): Promise<ContextCollapseCommittedEntry | null> {
  if (!args.sessionSaveEnabled) return null
  if (!args.metadata) return null

  await args.writer?.appendEvent('request_collapse_applied', {
    phase: args.phase,
    collapsedHeadMessageCount: args.collapsedHeadMessageCount,
    estimatedTokensSaved: args.estimatedTokensSaved,
    schemaVersion: args.metadata.schemaVersion,
    recapKind: args.metadata.kind,
    keepLastTurns: args.metadata.keepLastTurns,
    preservedTailMessageCount: args.metadata.preservedTailMessageCount,
    retainedCompactSummary: args.metadata.retainedCompactSummary,
    recentUserPromptCount: args.metadata.recentUserPromptCount,
    recentFileCount: args.metadata.recentFileCount,
    earlierToolResultBlockCount: args.metadata.earlierToolResultBlockCount,
    recapFingerprint: args.metadata.recapFingerprint,
  })
  if (!args.commit) return null
  const entry = createContextCollapseCommittedEntry({
    id: `request-collapse:${args.phase}:${args.metadata.recapFingerprint}`,
    createdAtMs: Date.now(),
    source: 'request_collapse',
    collapsedRange: args.commit.collapsedRange,
    compactBoundaryFingerprint: args.commit.compactBoundaryFingerprint,
    recapMessage: args.commit.recapMessage,
    metadata: args.metadata,
  })
  await args.writer?.appendEvent(CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME, entry)
  return entry
}

export async function recordRequestSnipEvent(args: {
  sessionSaveEnabled: boolean
  writer: SessionEventWriter
  phase: 'initial' | 'reactive_retry'
  state: RequestSnipEventState | null | undefined
}): Promise<void> {
  if (!args.sessionSaveEnabled) return
  if (!args.state?.applied || args.state.removals.length === 0) return

  await args.writer?.appendEvent(DURABLE_SNIP_COMMITTED_EVENT_NAME, {
    schemaVersion: 1,
    source: 'request_snip',
    phase: args.phase,
    estimatedTokensSaved: args.state.estimatedTokensSaved,
    removedMessageCount: args.state.removedMessageCount,
    compactBoundaryFingerprint: args.state.compactBoundaryFingerprint,
    baseProjectionFingerprint: args.state.baseProjectionFingerprint,
    sourceProjectionKind: args.state.sourceProjectionKind,
    removals: args.state.removals,
  })
}

export function recordReactiveCompactEvent(args: {
  sessionSaveEnabled: boolean
  writer: SessionEventWriter
  triggerKind: ReactiveCompactErrorKind
  triggerDetail: string
  strategy: 'session_memory' | 'model_summary'
}): void {
  if (!args.sessionSaveEnabled) return
  void args.writer?.appendEvent('reactive_compact_applied', {
    triggerKind: args.triggerKind,
    triggerDetail: args.triggerDetail,
    strategy: args.strategy,
  })
}
