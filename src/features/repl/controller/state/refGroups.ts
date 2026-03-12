import { useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { TokenUsage } from '../../../../streaming/types'
import type { PromptBlock } from '../../../../prompts'
import type { ReplMode } from '../../mode'
import type { ContextBudgetConfig } from '../../../../chat/context/budget'
import { ReminderService } from '../../reminders/ReminderService'
import type { ExploreTaskBatch } from '../streaming/streaming'
import { createInitialTranscriptProjectionState } from '../../../semantics/projection'
import { SessionWriter } from '../../sessionSave/writer'
import type { SessionWriterRefs } from '../session'
import { buildMessageByIdMap } from '../session'

function useCanonicalRefs(threadId: string): {
  projectionRef: MutableRefObject<ReturnType<typeof createInitialTranscriptProjectionState>>
  replaySeqRef: MutableRefObject<number>
  turnIdRef: MutableRefObject<string | null>
  turnSeqRef: MutableRefObject<number>
  transientSnapshotRef: MutableRefObject<{ turnId: string; includeAssistantStreaming: boolean; messages: Msg[] } | null>
} {
  return {
    projectionRef: useRef(createInitialTranscriptProjectionState({ threadId })),
    replaySeqRef: useRef(0),
    turnIdRef: useRef<string | null>(null),
    turnSeqRef: useRef(0),
    transientSnapshotRef: useRef<{ turnId: string; includeAssistantStreaming: boolean; messages: Msg[] } | null>(null),
  }
}

function useModeRefs(initialMode: ReplMode): {
  currentRef: MutableRefObject<ReplMode>
  previousRef: MutableRefObject<ReplMode>
} {
  return {
    currentRef: useRef<ReplMode>(initialMode),
    previousRef: useRef<ReplMode>(initialMode),
  }
}

function useTurnFlowRefs(): {
  pendingExitPlanReminderRef: MutableRefObject<boolean>
  reminderServiceRef: MutableRefObject<ReminderService | null>
  contextBudgetConfigRef: MutableRefObject<ContextBudgetConfig | null>
  pendingInjectedBlocksRef: MutableRefObject<PromptBlock[]>
} {
  return {
    pendingExitPlanReminderRef: useRef(false),
    reminderServiceRef: useRef<ReminderService | null>(null),
    contextBudgetConfigRef: useRef<ContextBudgetConfig | null>(null),
    pendingInjectedBlocksRef: useRef<PromptBlock[]>([]),
  }
}

function useRuntimeStateRefs(): {
  sendSeqRef: MutableRefObject<number>
  autoCompactSeqRef: MutableRefObject<number>
  previousIsLoadingRef: MutableRefObject<boolean>
  claudeMdMetaSigRef: MutableRefObject<string | null>
  surfaceOpQueueRef: MutableRefObject<Promise<void>>
  pendingStaticSurfaceResetRef: MutableRefObject<boolean>
} {
  return {
    sendSeqRef: useRef(0),
    autoCompactSeqRef: useRef(-1_000_000),
    previousIsLoadingRef: useRef(false),
    claudeMdMetaSigRef: useRef<string | null>(null),
    surfaceOpQueueRef: useRef<Promise<void>>(Promise.resolve()),
    pendingStaticSurfaceResetRef: useRef(false),
  }
}

function useToolRuntimeRefs(): {
  nameByIdRef: MutableRefObject<Map<string, string>>
  inputByIdRef: MutableRefObject<Map<string, unknown>>
  statsByToolUseIdRef: MutableRefObject<Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>>
  kindByToolUseIdRef: MutableRefObject<Map<string, 'explore' | 'other'>>
  messageIdByToolUseIdRef: MutableRefObject<Map<string, string>>
  exploreBatchRef: MutableRefObject<ExploreTaskBatch | null>
} {
  return {
    nameByIdRef: useRef<Map<string, string>>(new Map()),
    inputByIdRef: useRef<Map<string, unknown>>(new Map()),
    statsByToolUseIdRef: useRef<Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>>(new Map()),
    kindByToolUseIdRef: useRef<Map<string, 'explore' | 'other'>>(new Map()),
    messageIdByToolUseIdRef: useRef<Map<string, string>>(new Map()),
    exploreBatchRef: useRef<ExploreTaskBatch | null>(null),
  }
}

function useSessionPersistenceRefs(args: {
  messages: Msg[]
  initialSessionFilePath?: string
}): {
  sessionTransitionQueueRef: MutableRefObject<Promise<void>>
  sessionTransitionPendingCountRef: MutableRefObject<number>
  sessionWriterRef: MutableRefObject<SessionWriter | null>
  sessionWriterInitPromiseRef: MutableRefObject<Promise<void> | null>
  initialSessionFilePathRef: MutableRefObject<string | undefined>
  lastPersistedSigByMsgIdRef: MutableRefObject<Map<string, string>>
  lastPersistedMsgByIdRef: MutableRefObject<Map<string, Msg>>
  previousMessagesRef: MutableRefObject<Msg[]>
  messageByIdRef: MutableRefObject<Map<string, Msg>>
  dirtyMessageIdsRef: MutableRefObject<Set<string>>
  sessionWriterRefs: SessionWriterRefs
} {
  const sessionTransitionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const sessionTransitionPendingCountRef = useRef(0)
  const sessionWriterRef = useRef<SessionWriter | null>(null)
  const sessionWriterInitPromiseRef = useRef<Promise<void> | null>(null)
  const initialSessionFilePathRef = useRef<string | undefined>(args.initialSessionFilePath)
  const lastPersistedSigByMsgIdRef = useRef<Map<string, string>>(new Map())
  const lastPersistedMsgByIdRef = useRef<Map<string, Msg>>(new Map())
  const previousMessagesRef = useRef<Msg[]>(args.messages)
  const messageByIdRef = useRef<Map<string, Msg>>(buildMessageByIdMap(args.messages))
  const dirtyMessageIdsRef = useRef<Set<string>>(new Set(args.messages.map((message) => message.id)))
  const sessionWriterRefs = useMemo<SessionWriterRefs>(
    () => ({
      sessionWriterRef,
      sessionWriterInitPromiseRef,
      lastPersistedSigByMsgIdRef,
      lastPersistedMsgByIdRef,
    }),
    [],
  )

  return {
    sessionTransitionQueueRef,
    sessionTransitionPendingCountRef,
    sessionWriterRef,
    sessionWriterInitPromiseRef,
    initialSessionFilePathRef,
    lastPersistedSigByMsgIdRef,
    lastPersistedMsgByIdRef,
    previousMessagesRef,
    messageByIdRef,
    dirtyMessageIdsRef,
    sessionWriterRefs,
  }
}

export {
  useCanonicalRefs,
  useModeRefs,
  useTurnFlowRefs,
  useRuntimeStateRefs,
  useToolRuntimeRefs,
  useSessionPersistenceRefs,
}
