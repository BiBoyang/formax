import { useCallback } from 'react'
import type { LocalCommandRecord } from '../../../commands/registry'
import type { SessionWriter } from '../../sessionSave/writer'
import {
  recordCompactRequestedEvent,
  recordLocalCommandInjectionEvent,
} from './index'

type CompactLifecycleEvent =
  | { type: 'compact_started'; source: string }
  | { type: 'compact_succeeded'; source: string }
  | { type: 'compact_failed'; source: string; error: string }

function useSessionEventRecorders(args: {
  sessionSaveEnabled: boolean
  writerRef: { current: SessionWriter | null }
}): {
  onCompactLifecycle: (event: CompactLifecycleEvent) => void
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
    onCompactRequested,
    onSlashLocalAsyncRecordForNextTurn,
    onSlashLocalRecordForNextTurn,
  }
}

export {
  useSessionEventRecorders,
}
