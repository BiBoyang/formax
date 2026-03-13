import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { RuntimeConfig } from '../../../../config/config'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { CanonicalEvent } from '../../../semantics/core'
import type { TranscriptProjectionState } from '../../../semantics/projection'
import {
  applyCanonicalProjectionToUi,
  projectCanonicalEvent,
} from './canonicalProjectionPipeline'

function useCanonicalEventHandler(args: {
  assistantTextMode: RuntimeConfig['ui']['assistantTextMode']
  projectionRef: { current: TranscriptProjectionState }
  turnIdRef: { current: string | null }
  transientSnapshotRef: {
    current: { turnId: string; includeAssistantStreaming: boolean; messages: Msg[] } | null
  }
  pendingStaticSurfaceResetRef: { current: boolean }
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setCanonicalTransientActive: Dispatch<SetStateAction<boolean>>
  setCanonicalTurnMessages: Dispatch<SetStateAction<Msg[]>>
  persistEvent: (event: CanonicalEvent) => void
}): { onCanonicalEvent: (event: CanonicalEvent) => void } {
  const {
    assistantTextMode,
    projectionRef,
    turnIdRef,
    transientSnapshotRef,
    pendingStaticSurfaceResetRef,
    setMessages,
    setCanonicalTransientActive,
    setCanonicalTurnMessages,
    persistEvent,
  } = args

  const onCanonicalEvent = useCallback((event: CanonicalEvent) => {
    persistEvent(event)

    const projectedOutput = projectCanonicalEvent({
      assistantTextMode,
      event,
      projection: projectionRef.current,
      activeTurnId: turnIdRef.current,
      previousTransient: transientSnapshotRef.current,
    })
    projectionRef.current = projectedOutput.projected.projection

    applyCanonicalProjectionToUi({
      event,
      projected: projectedOutput.projected,
      projectedStaticRows: projectedOutput.projectedStaticRows,
      projectedTransientRows: projectedOutput.projectedTransientRows,
      includeAssistantStreaming: projectedOutput.includeAssistantStreaming,
      pendingStaticSurfaceResetRef,
      transientSnapshotRef,
      setMessages,
      setCanonicalTransientActive,
      setCanonicalTurnMessages,
    })
  }, [
    assistantTextMode,
    pendingStaticSurfaceResetRef,
    persistEvent,
    projectionRef,
    setCanonicalTransientActive,
    setCanonicalTurnMessages,
    setMessages,
    transientSnapshotRef,
    turnIdRef,
  ])

  return { onCanonicalEvent }
}

export {
  useCanonicalEventHandler,
}
