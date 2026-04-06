import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { randomUUID } from 'node:crypto'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../config/config'
import type { Msg } from '../../shared/toolMessageTypes'
import type { ReplMode } from './mode'
import type { SlashCommandRegistry } from '../commands/registry'
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
  useReplOverlays,
  useTranscriptSurfaceActions,
} from './controller/ui'
import { useReplStreaming } from './controller/streaming/streaming'
import {
  useCanonicalEventHandler,
} from './controller/canonical'
import {
  buildPersistedMsgRefMap,
  buildPersistedSigMap,
  registerSessionWriterProcessHandlers,
  runNewSessionTransition,
  runResumeSessionTransition,
  useSessionPersistence,
  useSessionEventRecorders,
  useSessionWriterLifecycle,
  useConfigDialogInjection,
  useSessionActions,
} from './controller/session'
import { runAbortAction, runSendAction, persistCanonicalToolEvent } from './controller/turnActions'
import {
  useCanonicalRefs,
  useModeRefs,
  useRuntimeStateRefs,
  useSessionPersistenceRefs,
  useToolRuntimeRefs,
  useTurnStreamingRefs,
  useTurnFlowRefs,
} from './controller/state/refGroups'
import { useSessionResetActions } from './controller/state/useSessionResetActions'
import {
  resolveReplModeTransition,
  shouldInjectExitPlanReminder,
} from '../semantics/core'
import type { CanonicalEvent } from '../semantics/core'
import { SessionWriter } from './sessionSave/writer'
import { readSessionFile } from './sessionSave/reader'
import { createRuntimeFlags, type RuntimeFlags } from '../../config/runtimeFlags'
import { getDeferredToolExposureStore } from '../../tools/runtime/deferredToolExposure'
import type { SubAgentListItem } from '../subagents/types.js'

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
  allowedSubagents: SubAgentListItem[]
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
  allowedSubagents?: SubAgentListItem[]
  reloadSubagents?: () => Promise<SubAgentListItem[]>
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
  const {
    historyRef,
    abortControllerRef,
    currentAssistantIdRef,
    assistantBufferRef,
    thinkingRefs,
  } = useTurnStreamingRefs(deps.initialSession?.history ?? [])
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

  const { closeConfigDialogWithInjection } = useConfigDialogInjection({
    closeConfigDialog,
    sessionSaveEnabled,
    writerRef: sessionWriterRef,
    pendingInjectedBlocksRef: turnFlowRefs.pendingInjectedBlocksRef,
  })

  const {
    onCompactLifecycle,
    onCompactRequested,
    onSlashLocalAsyncRecordForNextTurn,
    onSlashLocalRecordForNextTurn,
  } = useSessionEventRecorders({
    sessionSaveEnabled,
    writerRef: sessionWriterRef,
  })

  const {
    resetStreamingBuffers,
    clearToolRuntimeState,
    clearCanonicalTransientState,
    resetSessionUiState,
    resetSessionState,
    nextCanonicalReplaySeq,
    nextCanonicalTurnSeq,
  } = useSessionResetActions({
    canonicalThreadId: CANONICAL_THREAD_ID,
    sessionRefs: {
      deferredToolExposureSessionKeyRef,
      historyRef,
      currentAssistantIdRef,
      assistantBufferRef,
    },
    thinkingRefs,
    toolRuntimeRefs,
    canonicalRefs,
    turnFlowRefs,
    runtimeStateRefs,
    setters: {
      setThinkingText,
      setThinkingStartedAtMs,
      setCanonicalTurnMessages,
      setCanonicalTransientActive,
      setError,
      setContext,
    },
  })

  const persistCanonicalEvent = useCallback((event: CanonicalEvent) => {
    persistCanonicalToolEvent({
      sessionSaveEnabled,
      event,
      writer: sessionWriterRef.current,
    })
  }, [sessionSaveEnabled])

  const { onCanonicalEvent } = useCanonicalEventHandler({
    assistantTextMode,
    projectionRef: canonicalRefs.projectionRef,
    turnIdRef: canonicalRefs.turnIdRef,
    transientSnapshotRef: canonicalRefs.transientSnapshotRef,
    pendingStaticSurfaceResetRef: runtimeStateRefs.pendingStaticSurfaceResetRef,
    setMessages,
    setCanonicalTransientActive,
    setCanonicalTurnMessages,
    persistEvent: persistCanonicalEvent,
  })

  const { resetTranscriptSurface, replaceTranscript } = useTranscriptSurfaceActions({
    surfaceOpQueueRef: runtimeStateRefs.surfaceOpQueueRef,
    onClearTerminal: deps.onClearTerminal,
    setTranscriptSeq,
    setMessages,
  })

  useEffect(() => {
    if (!runtimeStateRefs.pendingStaticSurfaceResetRef.current) return
    runtimeStateRefs.pendingStaticSurfaceResetRef.current = false
    void resetTranscriptSurface()
  }, [messages, resetTranscriptSurface])

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
    mode: deps.mode,
    getPlanPath: () => deps.planSession?.getPlanPath() ?? null,
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
    turnStreamingRefs: {
      currentAssistantIdRef,
      assistantBufferRef,
      thinkingRefs,
    },
    toolRuntimeRefs: {
      nameByIdRef: toolRuntimeRefs.nameByIdRef,
      inputByIdRef: toolRuntimeRefs.inputByIdRef,
      statsByToolUseIdRef: toolRuntimeRefs.statsByToolUseIdRef,
      kindByToolUseIdRef: toolRuntimeRefs.kindByToolUseIdRef,
      messageIdByToolUseIdRef: toolRuntimeRefs.messageIdByToolUseIdRef,
      exploreBatchRef: toolRuntimeRefs.exploreBatchRef,
    },
    turnFlowRefs: {
      reminderServiceRef: turnFlowRefs.reminderServiceRef,
      contextBudgetConfigRef: turnFlowRefs.contextBudgetConfigRef,
    },
    cwd: runtimeCwd,
    canonical: {
      threadId: CANONICAL_THREAD_ID,
      getTurnId: () => canonicalRefs.turnIdRef.current,
      nextReplaySeq: nextCanonicalReplaySeq,
      onEvent: onCanonicalEvent,
    },
  })

  const abort = useCallback(() => {
    runAbortAction({
      refs: {
        canonicalTurnIdRef: canonicalRefs.turnIdRef,
        canonicalTransientSnapshotRef: canonicalRefs.transientSnapshotRef,
        toolNameByIdRef: toolRuntimeRefs.nameByIdRef,
        abortControllerRef,
        bashModeInFlightRef,
        currentAssistantIdRef,
      },
      callbacks: {
        resetSessionUiState,
        clearCanonicalTransientState,
        clearToolRuntimeState,
        setMessages,
        setIsLoading,
        nextCanonicalReplaySeq,
        onCanonicalEvent,
      },
      runtime: {
        canonicalThreadId: CANONICAL_THREAD_ID,
        isLoading,
        userInput,
      },
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

  const {
    runNewSession,
    newSession,
    resumeSession,
    renameSession,
  } = useSessionActions({
    engine: deps.engine,
    isLoading,
    closeResumeDialog: () => closeResumeDialog(),
    sessionSaveEnabled,
    initialSessionFilePathRef,
    sessionTransitionQueueRef,
    sessionTransitionPendingCountRef,
    sessionWriterRef,
    sessionWriterInitPromiseRef,
    lastPersistedSigByMsgIdRef,
    lastPersistedMsgByIdRef,
    resetSessionState,
    replaceTranscript,
    historyRef,
    cwd: runtimeCwd,
    mode: deps.mode,
    getPlanPath: () => deps.planSession?.getPlanPath() ?? null,
    abort,
    setError: (message) => setError(message),
    runNewSessionTransition,
    runResumeSessionTransition,
    readSessionFile,
    openExistingSessionWriter: (path) => SessionWriter.openExisting({ filePath: path }),
    buildPersistedSigMap,
    buildPersistedMsgRefMap,
  })

  const send = useCallback(
    async (value: string, opts?: { preferredSlashSpecId?: string }) => {
      await runSendAction({
        input: { value, opts },
        deps: {
          cfg: deps.cfg,
          mode: deps.mode,
          engine: deps.engine,
          planSession: deps.planSession,
          commandRegistry: deps.commandRegistry,
          tools: deps.tools,
        },
        refs: {
          bashModeInFlightRef,
          sessionTransitionPendingCountRef,
          sessionWriterRef,
          canonicalProjectionRef: canonicalRefs.projectionRef,
          modeCurrentRef: modeRefs.currentRef,
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
          claudeMdMetaSigRef: runtimeStateRefs.claudeMdMetaSigRef,
        },
        callbacks: {
          ensureSessionWriter,
          runNewSession,
          resetStreamingBuffers,
          clearCanonicalTransientState,
          setMessages,
          setIsLoading,
          setLoadingText,
          setThinkingText,
          setError,
          setContext,
          setReplMode,
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
        },
        runtime: {
          canonicalThreadId: CANONICAL_THREAD_ID,
          isLoading,
          runtimeFlags,
          runtimeCwd,
          runtimeEnv,
          allowedSubagents,
          sessionSaveEnabled,
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
 
