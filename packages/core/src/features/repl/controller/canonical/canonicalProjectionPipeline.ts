import type { Dispatch, SetStateAction } from 'react'
import type { RuntimeConfig } from '../../../../config/config'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { CanonicalEvent } from '../../../semantics/core'
import type { TranscriptProjectionState } from '../../../semantics/projection'
import {
  assertReplCanonicalInvariants,
} from './canonicalInvariants'
import {
  projectCanonicalEventToTransientMessages,
} from './canonicalEventOrchestration'
import {
  mergeProjectedStaticRows,
} from './staticRows'

function projectCanonicalEvent(args: {
  assistantTextMode: RuntimeConfig['ui']['assistantTextMode']
  event: CanonicalEvent
  projection: TranscriptProjectionState
  activeTurnId: string | null
  previousTransient: { turnId: string; includeAssistantStreaming: boolean; messages: Msg[] } | null
}): {
  projected: ReturnType<typeof projectCanonicalEventToTransientMessages>
  projectedStaticRows: Msg[]
  projectedTransientRows: Msg[]
  includeAssistantStreaming: boolean
} {
  const includeAssistantStreaming = args.assistantTextMode === 'stream'
  const projected = projectCanonicalEventToTransientMessages({
    projection: args.projection,
    event: args.event,
    activeTurnId: args.activeTurnId,
    includeAssistantStreaming,
    previousTransient: args.previousTransient,
  })
  const projectedStaticRows: Msg[] = []
  const projectedTransientRows: Msg[] = []
  for (const message of projected.messages) {
    if (message.surfaceOwner === 'static') projectedStaticRows.push(message)
    else projectedTransientRows.push(message)
  }
  return {
    projected,
    projectedStaticRows,
    projectedTransientRows,
    includeAssistantStreaming,
  }
}

function applyCanonicalProjectionToUi(args: {
  event: CanonicalEvent
  projected: ReturnType<typeof projectCanonicalEventToTransientMessages>
  projectedStaticRows: Msg[]
  projectedTransientRows: Msg[]
  includeAssistantStreaming: boolean
  pendingStaticSurfaceResetRef: { current: boolean }
  transientSnapshotRef: {
    current: { turnId: string; includeAssistantStreaming: boolean; messages: Msg[] } | null
  }
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setCanonicalTransientActive: Dispatch<SetStateAction<boolean>>
  setCanonicalTurnMessages: Dispatch<SetStateAction<Msg[]>>
}): void {
  if (args.projectedStaticRows.length > 0 || args.event.kind === 'turn_footer') {
    args.setMessages((prev) => {
      const next = mergeProjectedStaticRows({
        prev,
        projectedStaticRows: args.projectedStaticRows,
        onNonAppendUpdate: () => {
          args.pendingStaticSurfaceResetRef.current = true
        },
      })
      if (args.event.kind === 'turn_footer') {
        assertReplCanonicalInvariants({
          projection: args.projected.projection,
          messages: next,
          targetTurnId: args.projected.turnId,
        })
      }
      return next
    })
  }

  args.setCanonicalTransientActive(args.projectedTransientRows.length > 0)
  args.transientSnapshotRef.current = {
    turnId: args.projected.turnId,
    includeAssistantStreaming: args.includeAssistantStreaming,
    messages: args.projectedTransientRows,
  }
  if (args.projected.changed) {
    args.setCanonicalTurnMessages(args.projectedTransientRows)
  }
}

export {
  projectCanonicalEvent,
  applyCanonicalProjectionToUi,
}
