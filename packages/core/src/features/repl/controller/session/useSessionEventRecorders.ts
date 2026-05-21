import { useCallback } from 'react'
import type { LocalCommandRecord } from '../../../commands/registry'
import type { SessionWriter } from '../../sessionSave/writer'
import {
  recordCompactRequestedEvent,
  recordLocalCommandInjectionEvent,
  recordReactiveCompactEvent,
  recordRequestCollapseEvent,
} from './sessionEvents'
import type { ContextCollapseMeta } from '../../../../chat/context/contextCollapse'
import type {
  ContextCollapseCommittedEntry,
  ContextCollapseCommitState,
} from '../../../../chat/context/contextCollapseStore'
import type { ReactiveCompactErrorKind } from '../shared/reactiveCompactTypes'

type CompactLifecycleEvent =
  | { type: 'compact_started'; source: string }
  | { type: 'compact_succeeded'; source: string }
  | { type: 'compact_failed'; source: string; error: string }

function useSessionEventRecorders(args: {
  sessionSaveEnabled: boolean
  writerRef: { current: SessionWriter | null }
  onContextCollapseCommitted?: (entry: ContextCollapseCommittedEntry) => void
}): {
  onCompactLifecycle: (event: CompactLifecycleEvent) => void
  onRequestCollapse: (event: {
    phase: 'initial' | 'reactive_retry'
    collapsedHeadMessageCount: number
    estimatedTokensSaved: number
    metadata: ContextCollapseMeta | null
    commit: ContextCollapseCommitState | null
  }) => Promise<void>
  onReactiveCompact: (event: {
    triggerKind: ReactiveCompactErrorKind
    triggerDetail: string
    strategy: 'session_memory' | 'model_summary'
  }) => void
  onCompactRequested: () => void
  onSlashLocalAsyncRecordForNextTurn: (record: LocalCommandRecord) => void
  onSlashLocalRecordForNextTurn: (record: LocalCommandRecord) => void
} {
  const onCompactLifecycle = useCallback(
    (event: CompactLifecycleEvent) => {
      if (!args.sessionSaveEnabled) return
      if (event.type === 'compact_started') {
        void args.writerRef.current?.appendEvent('compact_started', { source: event.source })
        return
      }
      if (event.type === 'compact_succeeded') {
        void args.writerRef.current?.appendEvent('compact_succeeded', { source: event.source })
        return
      }
      void args.writerRef.current?.appendEvent('compact_failed', {
        source: event.source,
        error: event.error,
      })
    },
    [args.sessionSaveEnabled, args.writerRef],
  )

  const onCompactRequested = useCallback(() => {
    recordCompactRequestedEvent({ sessionSaveEnabled: args.sessionSaveEnabled, writer: args.writerRef.current })
  }, [args.sessionSaveEnabled, args.writerRef])

  const onRequestCollapse = useCallback(
    async (event: {
      phase: 'initial' | 'reactive_retry'
      collapsedHeadMessageCount: number
      estimatedTokensSaved: number
      metadata: ContextCollapseMeta | null
      commit: ContextCollapseCommitState | null
    }) => {
      const entry = await recordRequestCollapseEvent({
        sessionSaveEnabled: args.sessionSaveEnabled,
        writer: args.writerRef.current,
        phase: event.phase,
        collapsedHeadMessageCount: event.collapsedHeadMessageCount,
        estimatedTokensSaved: event.estimatedTokensSaved,
        metadata: event.metadata,
        commit: event.commit,
      })
      if (entry) args.onContextCollapseCommitted?.(entry)
    },
    [args.sessionSaveEnabled, args.writerRef, args.onContextCollapseCommitted],
  )

  const onReactiveCompact = useCallback(
    (event: {
      triggerKind: ReactiveCompactErrorKind
      triggerDetail: string
      strategy: 'session_memory' | 'model_summary'
    }) => {
      recordReactiveCompactEvent({
        sessionSaveEnabled: args.sessionSaveEnabled,
        writer: args.writerRef.current,
        triggerKind: event.triggerKind,
        triggerDetail: event.triggerDetail,
        strategy: event.strategy,
      })
    },
    [args.sessionSaveEnabled, args.writerRef],
  )

  const onSlashLocalAsyncRecordForNextTurn = useCallback(
    (record: LocalCommandRecord) => {
      recordLocalCommandInjectionEvent({
        sessionSaveEnabled: args.sessionSaveEnabled,
        writer: args.writerRef.current,
        source: 'slash_local_async',
        record,
      })
    },
    [args.sessionSaveEnabled, args.writerRef],
  )

  const onSlashLocalRecordForNextTurn = useCallback(
    (record: LocalCommandRecord) => {
      recordLocalCommandInjectionEvent({
        sessionSaveEnabled: args.sessionSaveEnabled,
        writer: args.writerRef.current,
        source: 'slash_local',
        record,
      })
    },
    [args.sessionSaveEnabled, args.writerRef],
  )

  return {
    onCompactLifecycle,
    onRequestCollapse,
    onReactiveCompact,
    onCompactRequested,
    onSlashLocalAsyncRecordForNextTurn,
    onSlashLocalRecordForNextTurn,
  }
}

export {
  useSessionEventRecorders,
}
