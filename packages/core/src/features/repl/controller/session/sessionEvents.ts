import { getClaudeMdInjectionMeta } from '../../injectedBlocks'
import { getLocalCommandInjectionStats } from './localCommandInjection'
import type { LocalCommandRecord } from '../../../commands/registry'
import type { SessionWriter } from '../../sessionSave/writer'
import type { ContextCollapseMeta } from '../../../../chat/context/contextCollapse'
import type { ReactiveCompactErrorKind } from '../send/reactiveCompact'

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

export function recordRequestCollapseEvent(args: {
  sessionSaveEnabled: boolean
  writer: SessionEventWriter
  phase: 'initial' | 'reactive_retry'
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  metadata: ContextCollapseMeta | null
}): void {
  if (!args.sessionSaveEnabled) return
  if (!args.metadata) return

  void args.writer?.appendEvent('request_collapse_applied', {
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
