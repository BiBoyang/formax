import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { randomUUID } from 'node:crypto'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../config/config'
import type { Msg } from '../../shared/toolMessageTypes'
import type { ReplMode } from './mode'
import type { SlashCommandRegistry } from '../commands/registry'
import type { LocalCommandRecord } from '../commands/registry'
import type { PlanSessionManager } from './planSession'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import type {
  AgentsDialogGenerateDraft,
  AgentsDialogSaveArgs,
  AgentsDialogSaveResult,
  ConfigDialogExit,
  ModelDialogExit,
  ResumeDialogExit,
} from '../../shared/replDialogContracts.js'
import {
  partitionMessages,
  queueTranscriptSurfaceReplace,
  queueTranscriptSurfaceReset,
  useReplOverlays,
} from './controller/ui'
import { useReplStreaming } from './controller/streaming/streaming'
import {
  appendCanonicalTailFinalRows,
  applyCanonicalProjectionToUi,
  assertReplCanonicalInvariants,
  mergeProjectedStaticRows,
  projectCanonicalEvent,
  safeJson,
  areToolInfosEqual,
  shouldKeepExistingStaticRow,
} from './controller/canonical'
import {
  applyConfigExitInjection,
  buildPersistedMsgRefMap,
  buildPersistedSigMap,
  recordCompactRequestedEvent,
  recordLocalCommandInjectionEvent,
  registerSessionWriterProcessHandlers,
  runNewSessionTransition,
  runResumeSessionTransition,
  queueSessionTransition as queueSessionTransitionAction,
  runNewSessionAction,
  runResumeSessionAction,
  renameSessionAction,
  useSessionPersistence,
  useSessionWriterLifecycle,
} from './controller/session'
import type { CompactLifecycleEvent } from './controller/send/compactFlow'
import { runAbortAction, runSendAction, persistCanonicalToolEvent } from './controller/turnActions'
import {
  hasRunningAskTool,
  mapLocalBashTurnOutcomeForTail,
  shouldBlockSendWhileBusy,
} from './controller/send/turnGuards'
import {
  useCanonicalRefs,
  useModeRefs,
  useRuntimeStateRefs,
  useSessionPersistenceRefs,
  useToolRuntimeRefs,
  useTurnFlowRefs,
} from './controller/state/refGroups'
import {
  clearCanonicalTransientState as clearCanonicalTransientStateInternal,
  clearToolRuntimeState as clearToolRuntimeStateInternal,
  nextCanonicalReplaySeq as nextCanonicalReplaySeqInternal,
  nextCanonicalTurnSeq as nextCanonicalTurnSeqInternal,
  resetCanonicalProjectionState as resetCanonicalProjectionStateInternal,
  resetSessionRefs as resetSessionRefsInternal,
  resetSessionUiState as resetSessionUiStateInternal,
  resetStreamingBuffers as resetStreamingBuffersInternal,
} from './controller/state/sessionReset'
import {
  resolveReplModeTransition,
  shouldInjectExitPlanReminder,
} from '../semantics/core'
import type { CanonicalEvent } from '../semantics/core'
import { SessionWriter } from './sessionSave/writer'
import { readSessionFile } from './sessionSave/reader'
import { createRuntimeFlags, type RuntimeFlags } from '../../config/runtimeFlags'
import { getDeferredToolExposureStore } from '../../tools/runtime/deferredToolExposure'

const CANONICAL_THREAD_ID = 'tui-live'

export type ReplControllerState = {
  messages: Msg[]
  staticMessages: Msg[]
  transientMessages: Msg[]
  transcriptSeq: number
  isLoading: boolean
  loadingText: string
  thinkingText: string
  thinkingStartedAtMs: number | null
  error: string | null
  allowedSubagents: Array<{ name: string; description: string }>
  agentsDialogOpen: boolean
  permissionsDialogOpen: boolean
  hooksDialogOpen: boolean
  configDialogOpen: boolean
  modelDialogOpen: boolean
  resumeDialogOpen: boolean
  context: null | {
    usedTokens: number
    limitTokens: number
    percentRemaining: number
    source: 'estimate' | 'usage'
  }
}

export type ReplController = {
  state: ReplControllerState
  actions: {
    send: (text: string, opts?: { preferredSlashSpecId?: string }) => Promise<void>
    newSession: () => void
    resetTranscriptSurface: () => Promise<void>
    abort: () => void
    closeAgentsDialog: (args: { createdAgents: string[] }) => void
    closePermissionsDialog: () => void
    closeHooksDialog: () => void
    closeConfigDialog: (exit: ConfigDialogExit) => void
    closeModelDialog: (exit: ModelDialogExit) => void
    closeResumeDialog: (exit?: ResumeDialogExit) => void
    resumeSession: (filePath: string) => Promise<void>
    renameSession: (filePath: string, label: string) => Promise<void>
    generateAgentDraft: (description: string, signal?: AbortSignal) => Promise<AgentsDialogGenerateDraft>
    saveAgentFromDialog: (args: AgentsDialogSaveArgs) => Promise<AgentsDialogSaveResult>
  }
}

export function useReplController(deps: {
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  onClearTerminal?: () => void | Promise<void>
  initialSession?: { filePath?: string; messages?: Msg[]; history?: ChatHistory }
  allowedSubagents?: Array<{ name: string; description: string }>
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
  mode: ReplMode
  onModeChange?: (mode: ReplMode) => void
  commandRegistry?: SlashCommandRegistry
  planSession?: PlanSessionManager
  env?: NodeJS.ProcessEnv
  cwd?: string
  runtimeFlags?: RuntimeFlags
}): ReplController {
  const runtimeEnv = deps.env ?? process.env
  const runtimeCwd = deps.cwd ?? process.cwd()
  const runtimeFlags = deps.runtimeFlags ?? createRuntimeFlags(runtimeEnv)
  const [messages, setMessages] = useState<Msg[]>(() => deps.initialSession?.messages ?? [])
  const [canonicalTurnMessages, setCanonicalTurnMessages] = useState<Msg[]>([])
  const [canonicalTransientActive, setCanonicalTransientActive] = useState(false)
  const [transcriptSeq, setTranscriptSeq] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Thinking')
  const [thinkingText, setThinkingText] = useState('')
  const [thinkingStartedAtMs, setThinkingStartedAtMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<ReplControllerState['context']>(null)
  const [allowedSubagents, setAllowedSubagents] = useState(deps.allowedSubagents ?? [])
  const {
    overlay,
    openOverlay,
    closeOverlay,
    closeAgentsDialog,
    closePermissionsDialog,
    closeHooksDialog,
    closeConfigDialog,
    closeModelDialog,
    closeResumeDialog,
    generateAgentDraft,
    saveAgentFromDialog,
  } = useReplOverlays({
    engine: deps.engine,
    model: deps.cfg.llm.model,
    projectAgentsDir: deps.cfg.paths.subagentsDir,
    reloadSubagents: deps.reloadSubagents,
    setAllowedSubagents,
    setMessages,
    initialOverlay: null,
  })

  const assistantTextMode = deps.cfg.ui.assistantTextMode
  const historyRef = useRef<ChatHistory>(deps.initialSession?.history ?? [])
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)
  const assistantBufferRef = useRef<string>('')
  const thinkingRefs = {
    bufferRef: useRef<string>(''),
    messageIdRef: useRef<string | null>(null),
    lastFlushAtRef: useRef(0),
    timingRef: useRef<{ startedAtMs: number | null }>({
      startedAtMs: null,
    }),
  }
  const toolRuntimeRefs = useToolRuntimeRefs()
  const canonicalRefs = useCanonicalRefs(CANONICAL_THREAD_ID)
  const modeRefs = useModeRefs(deps.mode)
  const turnFlowRefs = useTurnFlowRefs()
  const runtimeStateRefs = useRuntimeStateRefs()
  const deferredToolExposureSessionKeyRef = useRef<string>(randomUUID())
  // Local bash mode (`! <cmd>`) runs outside the LLM turn and must not overlap with other sends.
  const bashModeInFlightRef = useRef(false)
  const {
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
  } = useSessionPersistenceRefs({
    messages,
    initialSessionFilePath: deps.initialSession?.filePath,
  })
  const autoTitleRefs = {
    attemptedSessionIdsRef: useRef<Set<string>>(new Set()),
    checkedTopicPromptKeysRef: useRef<Set<string>>(new Set()),
  }

  const sessionSaveEnabled = runtimeFlags.sessionSaveEnabled
  const userInput = useUserInputManager()
  const { shutdownSessionWriter, ensureSessionWriter } = useSessionWriterLifecycle({
    sessionSaveEnabled,
    cwd: runtimeCwd,
    env: runtimeEnv,
    model: deps.cfg.llm.model,
    historyRef,
    refs: sessionWriterRefs,
    initialSessionFilePathRef,
    initialSessionMessages: deps.initialSession?.messages,
  })

  useEffect(() => {
    return () => {
      getDeferredToolExposureStore().resetSession(deferredToolExposureSessionKeyRef.current)
      if (!sessionSaveEnabled) return
      void shutdownSessionWriter()
    }
  }, [sessionSaveEnabled, shutdownSessionWriter])

  useEffect(() => {
    initialSessionFilePathRef.current = deps.initialSession?.filePath
  }, [deps.initialSession?.filePath])

  const closeConfigDialogWithInjection = useCallback(
    (exit: ConfigDialogExit) => {
      closeConfigDialog(exit)
      applyConfigExitInjection({
        exit,
        sessionSaveEnabled,
        writer: sessionWriterRef.current,
        pendingInjectedBlocksRef: turnFlowRefs.pendingInjectedBlocksRef,
      })
    },
    [closeConfigDialog, sessionSaveEnabled],
  )

  const resetStreamingBuffers = useCallback(() => {
    resetStreamingBuffersInternal({
      assistantBufferRef,
      thinkingBufferRef: thinkingRefs.bufferRef,
      thinkingMessageIdRef: thinkingRefs.messageIdRef,
      thinkingLastFlushAtRef: thinkingRefs.lastFlushAtRef,
      thinkingTimingRef: thinkingRefs.timingRef,
      setThinkingText,
      setThinkingStartedAtMs,
    })
  }, [])

  const clearToolRuntimeState = useCallback(() => {
    clearToolRuntimeStateInternal({
      toolNameByIdRef: toolRuntimeRefs.nameByIdRef,
      toolInputByIdRef: toolRuntimeRefs.inputByIdRef,
      taskStatsByToolUseIdRef: toolRuntimeRefs.statsByToolUseIdRef,
      taskKindByToolUseIdRef: toolRuntimeRefs.kindByToolUseIdRef,
      toolMessageIdByToolUseIdRef: toolRuntimeRefs.messageIdByToolUseIdRef,
      exploreBatchRef: toolRuntimeRefs.exploreBatchRef,
    })
  }, [])

  const clearCanonicalTransientState = useCallback(() => {
    clearCanonicalTransientStateInternal({
      transientSnapshotRef: canonicalRefs.transientSnapshotRef,
      setCanonicalTurnMessages,
      setCanonicalTransientActive,
    })
  }, [])

  const onCompactLifecycle = useCallback(
    (event: CompactLifecycleEvent) => {
      if (!sessionSaveEnabled) return
      if (event.type === 'compact_started') {
        void sessionWriterRef.current?.appendEvent('compact_started', { source: event.source })
        return
      }
      if (event.type === 'compact_succeeded') {
        void sessionWriterRef.current?.appendEvent('compact_succeeded', { source: event.source })
        return
      }
      void sessionWriterRef.current?.appendEvent('compact_failed', {
        source: event.source,
        error: event.error,
      })
    },
    [sessionSaveEnabled],
  )

  const onCompactRequested = useCallback(() => {
    recordCompactRequestedEvent({ sessionSaveEnabled, writer: sessionWriterRef.current })
  }, [sessionSaveEnabled])

  const onSlashLocalAsyncRecordForNextTurn = useCallback(
    (record: LocalCommandRecord) => {
      recordLocalCommandInjectionEvent({
        sessionSaveEnabled,
        writer: sessionWriterRef.current,
        source: 'slash_local_async',
        record,
      })
    },
    [sessionSaveEnabled],
  )

  const onSlashLocalRecordForNextTurn = useCallback(
    (record: LocalCommandRecord) => {
      recordLocalCommandInjectionEvent({
        sessionSaveEnabled,
        writer: sessionWriterRef.current,
        source: 'slash_local',
        record,
      })
    },
    [sessionSaveEnabled],
  )

  const resetSessionRefs = useCallback(() => {
    resetSessionRefsInternal({
      deferredToolExposureSessionKeyRef,
      historyRef,
      pendingInjectedBlocksRef: turnFlowRefs.pendingInjectedBlocksRef,
      pendingExitPlanReminderRef: turnFlowRefs.pendingExitPlanReminderRef,
      currentAssistantIdRef,
      contextBudgetConfigRef: turnFlowRefs.contextBudgetConfigRef,
      sendSeqRef: runtimeStateRefs.sendSeqRef,
      autoCompactSeqRef: runtimeStateRefs.autoCompactSeqRef,
      claudeMdMetaSigRef: runtimeStateRefs.claudeMdMetaSigRef,
      clearToolRuntimeState,
    })
  }, [clearToolRuntimeState])

  const resetCanonicalProjectionState = useCallback(() => {
    resetCanonicalProjectionStateInternal({
      canonicalThreadId: CANONICAL_THREAD_ID,
      projectionRef: canonicalRefs.projectionRef,
      replaySeqRef: canonicalRefs.replaySeqRef,
      turnIdRef: canonicalRefs.turnIdRef,
      turnSeqRef: canonicalRefs.turnSeqRef,
      clearCanonicalTransientState,
    })
  }, [clearCanonicalTransientState])

  const resetSessionUiState = useCallback(() => {
    resetSessionUiStateInternal({
      resetStreamingBuffers,
      setError,
      setContext,
    })
  }, [resetStreamingBuffers])

  const resetSessionState = useCallback(() => {
    resetSessionRefs()
    resetCanonicalProjectionState()
    resetSessionUiState()
  }, [resetCanonicalProjectionState, resetSessionRefs, resetSessionUiState])

  const nextCanonicalReplaySeq = useCallback(() => {
    return nextCanonicalReplaySeqInternal(canonicalRefs.replaySeqRef)
  }, [])

  const nextCanonicalTurnSeq = useCallback(() => {
    return nextCanonicalTurnSeqInternal(canonicalRefs.turnSeqRef)
  }, [])

  const onCanonicalEvent = useCallback((event: CanonicalEvent) => {
    persistCanonicalToolEvent({
      sessionSaveEnabled,
      event,
      writer: sessionWriterRef.current,
    })

    const projectedOutput = projectCanonicalEvent({
      assistantTextMode,
      event,
      projection: canonicalRefs.projectionRef.current,
      activeTurnId: canonicalRefs.turnIdRef.current,
      previousTransient: canonicalRefs.transientSnapshotRef.current,
    })
    canonicalRefs.projectionRef.current = projectedOutput.projected.projection

    applyCanonicalProjectionToUi({
      event,
      projected: projectedOutput.projected,
      projectedStaticRows: projectedOutput.projectedStaticRows,
      projectedTransientRows: projectedOutput.projectedTransientRows,
      includeAssistantStreaming: projectedOutput.includeAssistantStreaming,
      pendingStaticSurfaceResetRef: runtimeStateRefs.pendingStaticSurfaceResetRef,
      transientSnapshotRef: canonicalRefs.transientSnapshotRef,
      setMessages,
      setCanonicalTransientActive,
      setCanonicalTurnMessages,
    })
  }, [assistantTextMode, sessionSaveEnabled])

  useEffect(() => {
    if (!runtimeStateRefs.pendingStaticSurfaceResetRef.current) return
    runtimeStateRefs.pendingStaticSurfaceResetRef.current = false
    void queueTranscriptSurfaceReset({
      surfaceOpQueueRef: runtimeStateRefs.surfaceOpQueueRef,
      onClearTerminal: deps.onClearTerminal,
      setTranscriptSeq,
    })
  }, [deps.onClearTerminal, messages, runtimeStateRefs.surfaceOpQueueRef, setTranscriptSeq])

  useEffect(() => {
    setAllowedSubagents(deps.allowedSubagents ?? [])
  }, [deps.allowedSubagents])

  useEffect(() => {
    modeRefs.currentRef.current = deps.mode
    const prev = modeRefs.previousRef.current
    if (shouldInjectExitPlanReminder({ current: prev, next: deps.mode })) {
      turnFlowRefs.pendingExitPlanReminderRef.current = true
    }
    modeRefs.previousRef.current = deps.mode
  }, [deps.mode])

  useEffect(() => {
    return registerSessionWriterProcessHandlers({
      sessionSaveEnabled,
      isVitest: runtimeFlags.isVitest,
      getWriter: () => sessionWriterRef.current,
    })
  }, [runtimeFlags.isVitest, sessionSaveEnabled])

  const setReplMode = useCallback(
    (nextMode: ReplMode) => {
      const transition = resolveReplModeTransition({ current: modeRefs.currentRef.current, next: nextMode })
      if (!transition) return
      modeRefs.currentRef.current = transition.to
      deps.onModeChange?.(transition.to)
    },
    [deps.onModeChange],
  )

  const partitionedMessages = useMemo(() => partitionMessages(messages), [messages])
  const staticMessages = partitionedMessages.staticMessages
  const transientMessages = useMemo(() => {
    if (!canonicalTransientActive) return partitionedMessages.transientMessages
    return canonicalTurnMessages.filter((message) => message.surfaceOwner !== 'static')
  }, [canonicalTransientActive, canonicalTurnMessages, partitionedMessages.transientMessages])

  useSessionPersistence({
    sessionSaveEnabled,
    initialSessionFilePath: deps.initialSession?.filePath,
    ensureSessionWriter,
    messages,
    previousMessagesRef,
    messageByIdRef,
    dirtyMessageIdsRef,
    sessionWriterRef,
    lastPersistedSigByMsgIdRef,
    lastPersistedMsgByIdRef,
    isLoading,
    previousIsLoadingRef: runtimeStateRefs.previousIsLoadingRef,
    historyRef,
    engine: deps.engine,
    cwd: runtimeCwd,
    attemptedSessionIds: autoTitleRefs.attemptedSessionIdsRef.current,
    checkedTopicPromptKeys: autoTitleRefs.checkedTopicPromptKeysRef.current,
    model: deps.cfg.llm.model,
  })

  const { handleEvent } = useReplStreaming({
    assistantTextMode,
    setMessages,
    setThinkingText,
    setThinkingStartedAtMs,
    setLoadingText,
    setContext,
    setError,
    currentAssistantIdRef,
    assistantBufferRef,
    thinkingBufferRef: thinkingRefs.bufferRef,
    currentThinkingMessageIdRef: thinkingRefs.messageIdRef,
    thinkingLastFlushAtRef: thinkingRefs.lastFlushAtRef,
    thinkingTimingRef: thinkingRefs.timingRef,
    toolNameByIdRef: toolRuntimeRefs.nameByIdRef,
    toolInputByIdRef: toolRuntimeRefs.inputByIdRef,
    taskStatsByToolUseIdRef: toolRuntimeRefs.statsByToolUseIdRef,
    taskKindByToolUseIdRef: toolRuntimeRefs.kindByToolUseIdRef,
    toolMessageIdByToolUseIdRef: toolRuntimeRefs.messageIdByToolUseIdRef,
    cwd: runtimeCwd,
    exploreBatchRef: toolRuntimeRefs.exploreBatchRef,
    reminderServiceRef: turnFlowRefs.reminderServiceRef,
    contextBudgetConfigRef: turnFlowRefs.contextBudgetConfigRef,
    canonical: {
      threadId: CANONICAL_THREAD_ID,
      getTurnId: () => canonicalRefs.turnIdRef.current,
      nextReplaySeq: nextCanonicalReplaySeq,
      onEvent: onCanonicalEvent,
    },
  })

  const abort = useCallback(() => {
    runAbortAction({
      canonicalThreadId: CANONICAL_THREAD_ID,
      canonicalTurnIdRef: canonicalRefs.turnIdRef,
      canonicalTransientSnapshotRef: canonicalRefs.transientSnapshotRef,
      toolNameByIdRef: toolRuntimeRefs.nameByIdRef,
      isLoading,
      abortControllerRef,
      bashModeInFlightRef,
      userInput,
      resetSessionUiState,
      clearCanonicalTransientState,
      clearToolRuntimeState,
      currentAssistantIdRef,
      setMessages,
      setIsLoading,
      nextCanonicalReplaySeq,
      onCanonicalEvent,
    })
  }, [
    clearCanonicalTransientState,
    clearToolRuntimeState,
    isLoading,
    nextCanonicalReplaySeq,
    onCanonicalEvent,
    resetSessionUiState,
    userInput,
  ])

  const resetTranscriptSurface = useCallback(() => {
    // Ink <Static> is append-only; clear + remount must be serialized to avoid
    // rapid keypress races (Ctrl+O/Ctrl+E) that can leave stale frame artifacts.
    return queueTranscriptSurfaceReset({
      surfaceOpQueueRef: runtimeStateRefs.surfaceOpQueueRef,
      onClearTerminal: deps.onClearTerminal,
      setTranscriptSeq,
    })
  }, [deps.onClearTerminal, runtimeStateRefs.surfaceOpQueueRef])

  const replaceTranscript = useCallback(
    (nextMessages: Msg[]) => {
      return queueTranscriptSurfaceReplace({
        surfaceOpQueueRef: runtimeStateRefs.surfaceOpQueueRef,
        onClearTerminal: deps.onClearTerminal,
        setTranscriptSeq,
        setMessages,
        nextMessages,
      })
    },
    [deps.onClearTerminal, runtimeStateRefs.surfaceOpQueueRef],
  )

  const queueSessionTransition = useCallback(
    (run: () => Promise<void>): Promise<void> =>
      queueSessionTransitionAction({
        sessionTransitionQueueRef,
        sessionTransitionPendingCountRef,
        run,
      }),
    [],
  )

  const runNewSession = useCallback(async (): Promise<void> => {
    await runNewSessionAction({
      initialSessionFilePathRef,
      sessionTransitionQueueRef,
      sessionTransitionPendingCountRef,
      runNewSessionTransition,
      beginNewSession: () => deps.engine.beginNewSession?.({ source: 'clear' }),
      sessionSaveEnabled,
      sessionWriterRef,
      sessionWriterInitPromiseRef,
      lastPersistedSigByMsgIdRef,
      lastPersistedMsgByIdRef,
      resetSessionState,
      replaceTranscript,
    })
  }, [deps.engine, replaceTranscript, resetSessionState, sessionSaveEnabled])

  const newSession = useCallback(() => {
    void runNewSession()
  }, [runNewSession])

  const renameSession = useCallback(async (filePath: string, label: string): Promise<void> => {
    await renameSessionAction(filePath, label)
  }, [])

  const resumeSession = useCallback(
    async (filePath: string): Promise<void> => {
      await runResumeSessionAction({
        filePath,
        isLoading,
        closeResumeDialog: () => closeResumeDialog(),
        initialSessionFilePathRef,
        sessionTransitionQueueRef,
        sessionTransitionPendingCountRef,
        abort,
        runResumeSessionTransition,
        readSessionFile,
        beginNewSession: () => deps.engine.beginNewSession?.({ source: 'resume' }),
        sessionSaveEnabled,
        sessionWriterRef,
        lastPersistedSigByMsgIdRef,
        lastPersistedMsgByIdRef,
        resetSessionState,
        historyRef,
        replaceTranscript,
        openExistingSessionWriter: (path) => SessionWriter.openExisting({ filePath: path }),
        buildPersistedSigMap,
        buildPersistedMsgRefMap,
        setError: (message) => setError(message),
      })
    },
    [
      abort,
      closeResumeDialog,
      deps.engine,
      isLoading,
      replaceTranscript,
      resetSessionState,
      sessionSaveEnabled,
    ],
  )

  const send = useCallback(
    async (value: string, opts?: { preferredSlashSpecId?: string }) => {
      await runSendAction({
        value,
        opts,
        canonicalThreadId: CANONICAL_THREAD_ID,
        isLoading,
        bashModeInFlightRef,
        sessionTransitionPendingCountRef,
        cfg: deps.cfg,
        mode: deps.mode,
        engine: deps.engine,
        planSession: deps.planSession,
        commandRegistry: deps.commandRegistry,
        tools: deps.tools,
        runtimeFlags,
        runtimeCwd,
        runtimeEnv,
        allowedSubagents,
        sessionSaveEnabled,
        sessionWriterRef,
        ensureSessionWriter,
        runNewSession,
        resetStreamingBuffers,
        setMessages,
        setIsLoading,
        setLoadingText,
        setThinkingText,
        setError,
        setContext,
        modeCurrentRef: modeRefs.currentRef,
        setReplMode,
        historyRef,
        pendingInjectedBlocksRef: turnFlowRefs.pendingInjectedBlocksRef,
        contextBudgetConfigRef: turnFlowRefs.contextBudgetConfigRef,
        abortControllerRef,
        assistantBufferRef,
        thinkingBufferRef: thinkingRefs.bufferRef,
        thinkingLastFlushAtRef: thinkingRefs.lastFlushAtRef,
        currentAssistantIdRef,
        pendingExitPlanReminderRef: turnFlowRefs.pendingExitPlanReminderRef,
        deferredToolExposureSessionKeyRef,
        sendSeqRef: runtimeStateRefs.sendSeqRef,
        autoCompactSeqRef: runtimeStateRefs.autoCompactSeqRef,
        reminderServiceRef: turnFlowRefs.reminderServiceRef,
        canonicalTurnIdRef: canonicalRefs.turnIdRef,
        clearCanonicalTransientState,
        setCanonicalTransientActive,
        nextCanonicalTurnSeq,
        nextCanonicalReplaySeq,
        onCanonicalEvent,
        onCompactLifecycle,
        onCompactRequested,
        onSlashLocalAsyncRecordForNextTurn,
        onSlashLocalRecordForNextTurn,
        openOverlay,
        closeOverlay,
        handleEvent,
        claudeMdMetaSigRef: runtimeStateRefs.claudeMdMetaSigRef,
        appendEmptyBashUsageMessage: () => {
          setMessages((prev) => [
            ...prev,
            { id: `assistant-${Date.now()}`, role: 'assistant', content: 'Usage: ! <command>', timestamp: new Date() },
          ])
        },
        appendLocalBashCanonicalTail: ({ localTurnId, localTurnOutcome }) => {
          setMessages((prev) => {
            const nextMessages = appendCanonicalTailFinalRows({
              messages: prev,
              turnId: localTurnId,
              turnOutcome: mapLocalBashTurnOutcomeForTail(localTurnOutcome),
              projectionSegments: canonicalRefs.projectionRef.current.segments,
            })
            assertReplCanonicalInvariants({
              projection: canonicalRefs.projectionRef.current,
              messages: nextMessages,
              targetTurnId: localTurnId,
            })
            return nextMessages
          })
        },
      })
    },
    [
      allowedSubagents,
      deps.cfg,
      deps.commandRegistry,
      deps.engine,
      deps.mode,
      deps.planSession,
      deps.tools,
      closeOverlay,
      clearCanonicalTransientState,
      handleEvent,
      onCanonicalEvent,
      nextCanonicalReplaySeq,
      nextCanonicalTurnSeq,
      runNewSession,
      onCompactRequested,
      openOverlay,
      onSlashLocalAsyncRecordForNextTurn,
      onSlashLocalRecordForNextTurn,
      resetStreamingBuffers,
      runtimeCwd,
      runtimeEnv,
      runtimeFlags,
      isLoading,
      setReplMode,
      onCompactLifecycle,
      ensureSessionWriter,
    ],
  )

  return {
    state: {
      messages,
      staticMessages,
      transientMessages,
      transcriptSeq,
      isLoading,
      loadingText,
      thinkingText,
      thinkingStartedAtMs,
      error,
      allowedSubagents,
      agentsDialogOpen: overlay?.kind === 'agents',
      permissionsDialogOpen: overlay?.kind === 'permissions',
      hooksDialogOpen: overlay?.kind === 'hooks',
      configDialogOpen: overlay?.kind === 'config',
      modelDialogOpen: overlay?.kind === 'model',
      resumeDialogOpen: overlay?.kind === 'resume',
      context,
    },
    actions: {
      send,
      newSession,
      resetTranscriptSurface,
      abort,
      closeAgentsDialog,
      closePermissionsDialog,
      closeHooksDialog,
      closeConfigDialog: closeConfigDialogWithInjection,
      closeModelDialog,
      closeResumeDialog,
      resumeSession,
      renameSession,
      generateAgentDraft,
      saveAgentFromDialog,
    },
  }
}

export const __useReplControllerTestOnly = {
  safeJson,
  areToolInfosEqual,
  shouldKeepExistingStaticRow,
  mergeProjectedStaticRows,
  hasRunningAskTool,
  mapLocalBashTurnOutcomeForTail,
  enqueueSessionTransition: queueSessionTransitionAction,
  shouldBlockSendWhileBusy,
}
 
