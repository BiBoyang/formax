import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { TokenUsage } from '../../streaming/types'
import type { Msg } from '../../components/tool/ToolMessage'
import type { PromptBlock } from '../../prompts'
import type { ReplMode } from './mode'
import type { SlashCommandRegistry } from '../commands/registry'
import type { PlanSessionManager } from './planSession'
import type { SystemPromptProfile } from '../../prompts/system'
import { ReminderService } from './reminders/ReminderService'
import type { ContextBudgetConfig } from '../../chat/context/budget'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import type {
  AgentsDialogGenerateDraft,
  AgentsDialogSaveArgs,
  AgentsDialogSaveResult,
} from '../../ui/agents/AgentsDialog.js'
import type { ConfigDialogExit } from '../../ui/config/ConfigDialog.js'
import type { ModelDialogExit } from '../../ui/model/ModelDialog.js'
import { partitionMessages, useReplOverlays } from './controller/ui/ui'
import { useReplStreaming, type ExploreTaskBatch } from './controller/streaming/streaming'
import {
  appendCanonicalTurnFinalRows,
  canonicalTurnSegmentsToMessages,
  tailSegmentsForTurn,
  emitCanonicalUiMessageForTurn,
} from './controller/canonical/canonical'
import { isErrorLikeSubline, resolveTurnProvider } from './controller/shared/shared'
import {
  applyConfigExitInjection,
  buildPersistedSigMap,
  ensureSessionWriter as ensureSessionWriterInternal,
  openInitialSessionWriter as openInitialSessionWriterInternal,
  recordClaudeMdInjectionEvent,
  recordCompactRequestedEvent,
  recordLocalCommandInjectionEvent,
  shouldPersistUiMsg,
  shutdownSessionWriter as shutdownSessionWriterInternal,
  startNewSessionWriter as startNewSessionWriterInternal,
  runAbortSessionTransition,
  runNewSessionTransition,
  type SessionWriterRefs,
} from './controller/session/session'
import { createSendTurnContext } from './controller/send/sendTypes'
import { resolvePreMainSendRouting } from './controller/send/sendPreMainRouting'
import { runLocalBashTurn } from './controller/send/bashMode'
import { runMainSendTurn } from './controller/send/sendMainTurn'
import { createMainTurnExecutionContext } from './controller/send/sendMainTurnContext'
import type { CompactLifecycleEvent } from './controller/send/compactFlow'
import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
} from '../semantics/projection/projection'
import type { CanonicalEvent } from '../semantics/core/core'
import {
  resolveReplModeTransition,
  shouldInjectExitPlanReminder,
} from '../semantics/core/core'
import { SessionWriter } from './sessionSave/writer'
import { readSessionFile } from './sessionSave/reader'
import { createRuntimeFlags, type RuntimeFlags } from '../../env/runtimeFlags'
import { extractLastAssistantTextFromHistory, maybeAutoGenerateSessionTitle } from '../sessionTitle'

const CANONICAL_THREAD_ID = 'tui-live'

function waitForNextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

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
    closeResumeDialog: () => void
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
  promptProfile?: SystemPromptProfile
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
  const toolRuntimeRefs = {
    nameByIdRef: useRef<Map<string, string>>(new Map()),
    inputByIdRef: useRef<Map<string, unknown>>(new Map()),
    statsByToolUseIdRef: useRef<Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>>(new Map()),
    kindByToolUseIdRef: useRef<Map<string, 'explore' | 'other'>>(new Map()),
    messageIdByToolUseIdRef: useRef<Map<string, string>>(new Map()),
    exploreBatchRef: useRef<ExploreTaskBatch | null>(null),
  }
  const canonicalRefs = {
    projectionRef: useRef(createInitialTranscriptProjectionState({ threadId: CANONICAL_THREAD_ID })),
    replaySeqRef: useRef(0),
    turnIdRef: useRef<string | null>(null),
    turnSeqRef: useRef(0),
  }
  const modeRefs = {
    currentRef: useRef<ReplMode>(deps.mode),
    previousRef: useRef<ReplMode>(deps.mode),
  }
  const turnFlowRefs = {
    pendingExitPlanReminderRef: useRef(false),
    reminderServiceRef: useRef<ReminderService | null>(null),
    contextBudgetConfigRef: useRef<ContextBudgetConfig | null>(null),
    pendingInjectedBlocksRef: useRef<PromptBlock[]>([]),
  }
  const runtimeStateRefs = {
    sendSeqRef: useRef(0),
    autoCompactSeqRef: useRef(-1_000_000),
    previousIsLoadingRef: useRef(false),
    claudeMdMetaSigRef: useRef<string | null>(null),
    surfaceOpQueueRef: useRef<Promise<void>>(Promise.resolve()),
  }
  // Local bash mode (`! <cmd>`) runs outside the LLM turn and must not overlap with other sends.
  const bashModeInFlightRef = useRef(false)
  const sessionWriterRef = useRef<SessionWriter | null>(null)
  const sessionWriterInitPromiseRef = useRef<Promise<void> | null>(null)
  const lastPersistedSigByMsgIdRef = useRef<Map<string, string>>(new Map())
  const sessionWriterRefs: SessionWriterRefs = {
    sessionWriterRef,
    sessionWriterInitPromiseRef,
    lastPersistedSigByMsgIdRef,
  }
  const autoTitleRefs = {
    attemptedSessionIdsRef: useRef<Set<string>>(new Set()),
    checkedTopicPromptKeysRef: useRef<Set<string>>(new Set()),
  }

  const sessionSaveEnabled = runtimeFlags.sessionSaveEnabled
  const userInput = useUserInputManager()
  const startNewSessionWriter = useCallback(async (): Promise<void> => {
    await startNewSessionWriterInternal({
      sessionSaveEnabled,
      cwd: runtimeCwd,
      env: runtimeEnv,
      model: deps.cfg.llm.model,
      historyRef,
      refs: sessionWriterRefs,
    })
  }, [deps.cfg.llm.model, runtimeCwd, runtimeEnv, sessionSaveEnabled])

  const openInitialSessionWriter = useCallback(async (): Promise<void> => {
    await openInitialSessionWriterInternal({
      sessionSaveEnabled,
      initialSession: deps.initialSession,
      historyRef,
      refs: sessionWriterRefs,
      startNewWriter: startNewSessionWriter,
    })
  }, [deps.initialSession?.filePath, deps.initialSession?.messages, sessionSaveEnabled, startNewSessionWriter])

  const shutdownSessionWriter = useCallback(async (): Promise<void> => {
    await shutdownSessionWriterInternal(sessionWriterRefs)
  }, [])

  useEffect(() => {
    return () => {
      if (!sessionSaveEnabled) return
      void shutdownSessionWriter()
    }
  }, [sessionSaveEnabled, shutdownSessionWriter])

  const ensureSessionWriter = useCallback(async (): Promise<void> => {
    await ensureSessionWriterInternal({
      sessionSaveEnabled,
      refs: sessionWriterRefs,
      openInitialWriter: openInitialSessionWriter,
    })
  }, [openInitialSessionWriter, sessionSaveEnabled])

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
    assistantBufferRef.current = ''
    thinkingRefs.bufferRef.current = ''
    thinkingRefs.messageIdRef.current = null
    thinkingRefs.lastFlushAtRef.current = 0
    thinkingRefs.timingRef.current = { startedAtMs: null }
    setThinkingText('')
    setThinkingStartedAtMs(null)
  }, [])

  const clearToolRuntimeState = useCallback(() => {
    toolRuntimeRefs.nameByIdRef.current.clear()
    toolRuntimeRefs.inputByIdRef.current.clear()
    toolRuntimeRefs.statsByToolUseIdRef.current.clear()
    toolRuntimeRefs.kindByToolUseIdRef.current.clear()
    toolRuntimeRefs.messageIdByToolUseIdRef.current.clear()
    toolRuntimeRefs.exploreBatchRef.current = null
  }, [])

  const clearCanonicalTransientState = useCallback(() => {
    setCanonicalTurnMessages([])
    setCanonicalTransientActive(false)
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

  const resetSessionRefs = useCallback(() => {
    historyRef.current = []
    turnFlowRefs.pendingInjectedBlocksRef.current = []
    turnFlowRefs.pendingExitPlanReminderRef.current = false
    currentAssistantIdRef.current = null
    turnFlowRefs.contextBudgetConfigRef.current = null
    runtimeStateRefs.sendSeqRef.current = 0
    runtimeStateRefs.autoCompactSeqRef.current = -1_000_000
    clearToolRuntimeState()
    runtimeStateRefs.claudeMdMetaSigRef.current = null
  }, [clearToolRuntimeState])

  const resetCanonicalProjectionState = useCallback(() => {
    canonicalRefs.projectionRef.current = createInitialTranscriptProjectionState({ threadId: CANONICAL_THREAD_ID })
    canonicalRefs.replaySeqRef.current = 0
    canonicalRefs.turnIdRef.current = null
    canonicalRefs.turnSeqRef.current = 0
    clearCanonicalTransientState()
  }, [clearCanonicalTransientState])

  const resetSessionUiState = useCallback(() => {
    resetStreamingBuffers()
    setError(null)
    setContext(null)
  }, [resetStreamingBuffers])

  const resetSessionState = useCallback(() => {
    resetSessionRefs()
    resetCanonicalProjectionState()
    resetSessionUiState()
  }, [resetCanonicalProjectionState, resetSessionRefs, resetSessionUiState])

  const nextCanonicalReplaySeq = useCallback(() => {
    canonicalRefs.replaySeqRef.current += 1
    return canonicalRefs.replaySeqRef.current
  }, [])

  const nextCanonicalTurnSeq = useCallback(() => {
    canonicalRefs.turnSeqRef.current += 1
    return canonicalRefs.turnSeqRef.current
  }, [])

  const onCanonicalEvent = useCallback((event: CanonicalEvent) => {
    canonicalRefs.projectionRef.current = reduceTranscriptProjection(canonicalRefs.projectionRef.current, event)
    setCanonicalTransientActive(true)
    const turnId = canonicalRefs.turnIdRef.current ?? event.turnId
    const turnTailSegments = tailSegmentsForTurn(canonicalRefs.projectionRef.current.segments, turnId)
    setCanonicalTurnMessages(
      canonicalTurnSegmentsToMessages({
        turnId,
        segments: turnTailSegments,
        transientOnly: true,
        openAssistantSegmentId: canonicalRefs.projectionRef.current.openAssistantSegmentIdByTurn[turnId],
        includeAssistantStreaming: assistantTextMode === 'stream',
        includeUserSystem: false,
      }),
    )
  }, [assistantTextMode])

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
    if (!sessionSaveEnabled) return
    // Avoid altering Vitest's process-level behavior (it relies on these signals/exceptions).
    if (runtimeFlags.isVitest) return

    const flushBestEffort = async () => {
      try {
        await sessionWriterRef.current?.flush()
      } catch {
        // ignore
      }
    }

    const forwardSignal = (signal: NodeJS.Signals) => {
      const handler = () => {
        process.off(signal, handler)
        void flushBestEffort().finally(() => {
          try {
            process.kill(process.pid, signal)
          } catch {
            // ignore
          }
        })
      }
      process.on(signal, handler)
      return () => process.off(signal, handler)
    }

    const offSigInt = forwardSignal('SIGINT')
    const offSigTerm = forwardSignal('SIGTERM')

    const onBeforeExit = () => {
      void flushBestEffort()
    }
    process.on('beforeExit', onBeforeExit)

    const onUncaught = (err: unknown) => {
      void (async () => {
        await flushBestEffort()
        // Preserve default-ish behavior: print and exit non-zero.
        // eslint-disable-next-line no-console
        console.error(err)
        process.exitCode = 1
        process.exit()
      })()
    }
    process.on('uncaughtException', onUncaught)

    const onUnhandled = (reason: unknown) => {
      void (async () => {
        await flushBestEffort()
        // eslint-disable-next-line no-console
        console.error(reason)
        process.exitCode = 1
        process.exit()
      })()
    }
    process.on('unhandledRejection', onUnhandled)

    return () => {
      offSigInt()
      offSigTerm()
      process.off('beforeExit', onBeforeExit)
      process.off('uncaughtException', onUncaught)
      process.off('unhandledRejection', onUnhandled)
    }
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
  const transientMessages = useMemo(
    () => (isLoading && canonicalTransientActive ? canonicalTurnMessages : partitionedMessages.transientMessages),
    [canonicalTransientActive, canonicalTurnMessages, isLoading, partitionedMessages.transientMessages],
  )

  useEffect(() => {
    if (!sessionSaveEnabled) return
    void ensureSessionWriter()
    return () => {
      void shutdownSessionWriter()
    }
  }, [ensureSessionWriter, sessionSaveEnabled, shutdownSessionWriter])

  useEffect(() => {
    const writer = sessionWriterRef.current
    if (!writer) return

    for (const msg of messages) {
      if (!shouldPersistUiMsg(msg)) continue
      const sig = JSON.stringify(msg)
      const prev = lastPersistedSigByMsgIdRef.current.get(msg.id)
      if (prev === sig) continue
      lastPersistedSigByMsgIdRef.current.set(msg.id, sig)
      void writer.appendStableMsg(msg)
    }
  }, [messages])

  useEffect(() => {
    const writer = sessionWriterRef.current
    const wasLoading = runtimeStateRefs.previousIsLoadingRef.current
    runtimeStateRefs.previousIsLoadingRef.current = isLoading
    if (!writer) return
    if (wasLoading && !isLoading) {
      void writer.appendHistorySnapshot(historyRef.current)
      const uiMsgCount = messages.filter(shouldPersistUiMsg).length
      const userPrompts = messages
        .filter((m) => m.role === 'user')
        .map((m) => String(m.content ?? '').trim())
        .filter((text) => Boolean(text))
      const firstUserPrompt = userPrompts[0] ?? null
      const lastUserPrompt = userPrompts[userPrompts.length - 1] ?? null
      void writer.appendEvent('ui_stats', { uiMsgCount, lastUserPrompt, firstUserPrompt })
      const assistantText = extractLastAssistantTextFromHistory(historyRef.current)
      void maybeAutoGenerateSessionTitle({
        filePath: writer.filePath,
        engine: deps.engine,
        cwd: runtimeCwd,
        attemptedSessionIds: autoTitleRefs.attemptedSessionIdsRef.current,
        checkedTopicPromptKeys: autoTitleRefs.checkedTopicPromptKeysRef.current,
        writer,
        userText: firstUserPrompt ?? lastUserPrompt,
        topicUserText: lastUserPrompt,
        assistantText,
        model: deps.cfg.llm.model,
      }).catch(() => null)
    }
  }, [deps.cfg.llm.model, deps.engine, isLoading, messages, runtimeCwd])

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
    runAbortSessionTransition({
      isLoading,
      abortControllerRef,
      bashModeInFlightRef,
      toolNameByIdRef: toolRuntimeRefs.nameByIdRef,
      userInput,
      resetSessionUiState,
      clearCanonicalTransientState,
      clearToolRuntimeState,
      currentAssistantIdRef,
      setMessages,
      setIsLoading,
    })
  }, [clearCanonicalTransientState, clearToolRuntimeState, isLoading, resetSessionUiState, userInput])

  const newSession = useCallback(() => {
    runNewSessionTransition({
      beginNewSession: () => deps.engine.beginNewSession?.({ source: 'clear' }),
      sessionSaveEnabled,
      sessionWriterRef,
      lastPersistedSigByMsgIdRef,
      resetSessionState,
      setTranscriptSeq,
      setMessages,
      onClearTerminal: deps.onClearTerminal,
      startNewSessionWriter,
      sessionWriterInitPromiseRef,
    })
  }, [deps.engine, deps.onClearTerminal, resetSessionState, sessionSaveEnabled, startNewSessionWriter])

  const enqueueSurfaceOp = useCallback((op: () => Promise<void>) => {
    const next = runtimeStateRefs.surfaceOpQueueRef.current.catch(() => undefined).then(op)
    runtimeStateRefs.surfaceOpQueueRef.current = next.catch(() => undefined)
    return next
  }, [])

  const resetTranscriptSurface = useCallback(() => {
    // Ink <Static> is append-only; clear + remount must be serialized to avoid
    // rapid keypress races (Ctrl+O/Ctrl+E) that can leave stale frame artifacts.
    return enqueueSurfaceOp(async () => {
      await deps.onClearTerminal?.()
      setTranscriptSeq((n) => n + 1)
      await waitForNextMacrotask()
    })
  }, [deps.onClearTerminal, enqueueSurfaceOp])

  const renameSession = useCallback(async (filePath: string, label: string): Promise<void> => {
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendEvent('session_rename', { label })
    await writer.shutdown()
  }, [])

  const resumeSession = useCallback(
    async (filePath: string): Promise<void> => {
      if (isLoading) return

      abort()
      closeResumeDialog()

      const replay = await readSessionFile(filePath)
      deps.engine.beginNewSession?.({ source: 'resume' })

      // Flush and close the current writer (if any) before switching to the resumed session file.
      if (sessionSaveEnabled) {
        const old = sessionWriterRef.current
        sessionWriterRef.current = null
        lastPersistedSigByMsgIdRef.current = new Map()
        void (async () => {
          if (!old) return
          await old.appendEvent('resume_switch', { to: filePath })
          await old.shutdown()
        })()
      }

      // Reset transient runtime state, then restore persisted state.
      resetSessionState()
      historyRef.current = replay.history

      // Replace transcript and remount Ink <Static> so old append-only content disappears.
      setMessages(() => replay.messages)
      lastPersistedSigByMsgIdRef.current = buildPersistedSigMap(replay.messages)
      setTranscriptSeq((n) => n + 1)
      void deps.onClearTerminal?.()

      if (sessionSaveEnabled) {
        const writer = await SessionWriter.openExisting({ filePath })
        sessionWriterRef.current = writer
        await writer.appendEvent('resume')
        await writer.appendHistorySnapshot(historyRef.current)
      }
    },
    [
      abort,
      closeResumeDialog,
      deps.engine,
      deps.onClearTerminal,
      isLoading,
      resetSessionState,
      sessionSaveEnabled,
      setMessages,
      setTranscriptSeq,
    ],
  )

  const send = useCallback(
    async (value: string, opts?: { preferredSlashSpecId?: string }) => {
      const text = value.trim()
      if (!text || isLoading || bashModeInFlightRef.current) return

      let provider: 'openai' | 'anthropic' = 'anthropic'
      let providerError: string | null = null
      try {
        provider = resolveTurnProvider(deps.cfg.llm.provider)
      } catch (error) {
        providerError = error instanceof Error ? error.message : 'Unsupported provider'
      }

      // Thinking/streaming state is per-turn; clear buffers so stale thinking
      // from previous turns can't leak into the next status line/panel.
      resetStreamingBuffers()

      await ensureSessionWriter()

      // Bash mode (`!` prefix): run a local shell command without involving the LLM.
      // The command + output are injected into the *next* real turn.
      if (text.startsWith('!')) {
        const command = text.replace(/^!\s*/, '').trim()
        if (!command) {
          setMessages((prev) => [
            ...prev,
            { id: `assistant-${Date.now()}`, role: 'assistant', content: 'Usage: ! <command>', timestamp: new Date() },
          ])
          return
        }

        // Treat bash-mode as an in-flight operation: prevent overlapping sends and allow Ctrl+C to abort.
        // We intentionally avoid the LLM "isLoading" spinner here; the tool message itself is the UI.
        bashModeInFlightRef.current = true

        const localTurnId = `local-bash-${nextCanonicalTurnSeq()}`

        try {
          await runLocalBashTurn({
            command,
            cwd: runtimeCwd,
            env: runtimeEnv,
            runtimeFlags,
            threadId: CANONICAL_THREAD_ID,
            turnId: localTurnId,
            nextReplaySeq: nextCanonicalReplaySeq,
            onCanonicalEvent,
            setMessages,
            pendingInjectedBlocksRef: turnFlowRefs.pendingInjectedBlocksRef,
            abortControllerRef,
            clearCanonicalTransientState,
          })
        } finally {
          bashModeInFlightRef.current = false
        }

        return
      }

      recordClaudeMdInjectionEvent({
        sessionSaveEnabled,
        promptProfile: deps.promptProfile ?? deps.cfg.ui.promptProfile,
        cwd: runtimeCwd,
        env: runtimeEnv,
        lastSigRef: runtimeStateRefs.claudeMdMetaSigRef,
        writer: sessionWriterRef.current,
      })

      const { sendStateSetters, replModeAccess, sendTurnSharedRefs } = createSendTurnContext({
        setMessages,
        setIsLoading,
        setLoadingText,
        setThinkingText,
        setError,
        setContext,
        getReplMode: () => modeRefs.currentRef.current,
        setReplMode,
        historyRef,
        pendingInjectedBlocksRef: turnFlowRefs.pendingInjectedBlocksRef,
        contextBudgetConfigRef: turnFlowRefs.contextBudgetConfigRef,
        abortControllerRef,
        assistantBufferRef,
        thinkingBufferRef: thinkingRefs.bufferRef,
        thinkingLastFlushAtRef: thinkingRefs.lastFlushAtRef,
        currentAssistantIdRef,
      })

      const preMainRouting = await resolvePreMainSendRouting({
        text,
        preferredSlashSpecId: opts?.preferredSlashSpecId,
        isLoading,
        provider,
        providerError,
        engine: deps.engine,
        cfg: deps.cfg,
        promptProfile: deps.promptProfile,
        allowedSubagents,
        mode: deps.mode,
        ...replModeAccess,
        getPlanPath: () => deps.planSession?.getPlanPath() ?? null,
        ...sendTurnSharedRefs,
        commandRegistry: deps.commandRegistry,
        openOverlay,
        closeOverlay,
        newSession,
        ...sendStateSetters,
        handleEvent,
        onCompactLifecycle,
        onCompactRequested: () => recordCompactRequestedEvent({ sessionSaveEnabled, writer: sessionWriterRef.current }),
        onSlashLocalAsyncRecordForNextTurn: (rec) =>
          recordLocalCommandInjectionEvent({
            sessionSaveEnabled,
            writer: sessionWriterRef.current,
            source: 'slash_local_async',
            record: rec,
          }),
        onSlashLocalRecordForNextTurn: (rec) =>
          recordLocalCommandInjectionEvent({
            sessionSaveEnabled,
            writer: sessionWriterRef.current,
            source: 'slash_local',
            record: rec,
          }),
      })
      if (preMainRouting.shouldReturn) return
      const slashEffect = preMainRouting.slashEffect
      if (providerError) {
        setError(providerError)
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            ui: { kind: 'command_subline' },
            content: providerError,
            timestamp: new Date(),
          },
        ])
        return
      }

      const canonicalTurnId = `turn-${nextCanonicalTurnSeq()}`
      canonicalRefs.turnIdRef.current = canonicalTurnId
      setCanonicalTransientActive(false)
      let turnUserMessageId: string | null = null
      let turnOutcome: 'completed' | 'aborted' | 'failed' = 'completed'
      const mainTurnExecutionContext = createMainTurnExecutionContext({
        engine: deps.engine,
        cfg: deps.cfg,
        promptProfile: deps.promptProfile,
        planSession: deps.planSession ?? null,
        reminderServiceRef: turnFlowRefs.reminderServiceRef,
        tools: deps.tools,
        allowedSubagents,
        mode: deps.mode,
        replModeAccess,
        handleEvent,
        sendTurnSharedRefs,
        pendingExitPlanReminderRef: turnFlowRefs.pendingExitPlanReminderRef,
        sendSeqRef: runtimeStateRefs.sendSeqRef,
        lastAutoCompactSeqRef: runtimeStateRefs.autoCompactSeqRef,
        onCompactLifecycle,
      })
      try {
        const runResult = await runMainSendTurn({
          input: { text, slashEffect, provider },
          deps: mainTurnExecutionContext.deps,
          refs: mainTurnExecutionContext.refs,
          state: {
            ...sendStateSetters,
            emitCanonicalUiMessage: (message) =>
              emitCanonicalUiMessageForTurn({
                threadId: CANONICAL_THREAD_ID,
                turnId: canonicalTurnId,
                message,
                nextReplaySeq: nextCanonicalReplaySeq,
                onCanonicalEvent,
              }),
          },
        })
        turnUserMessageId = runResult.userMessageId
        turnOutcome = runResult.turnOutcome
      } finally {
        setMessages((prev) =>
          appendCanonicalTurnFinalRows({
            messages: prev,
            userMessageId: turnUserMessageId,
            turnId: canonicalTurnId,
            turnOutcome,
            projectionSegments: canonicalRefs.projectionRef.current.segments,
            isFailureSubline: (message) =>
              Boolean(
                message &&
                  message.role === 'assistant' &&
                  message.ui?.kind === 'command_subline' &&
                  isErrorLikeSubline(String(message.content || '')),
              ),
          }),
        )
        canonicalRefs.turnIdRef.current = null
        clearCanonicalTransientState()
      }
    },
    [
      allowedSubagents,
      deps.cfg,
      deps.commandRegistry,
      deps.engine,
      deps.mode,
      deps.planSession,
      deps.promptProfile,
      deps.reloadSubagents,
      deps.tools,
      closeOverlay,
      clearCanonicalTransientState,
      handleEvent,
      onCanonicalEvent,
      nextCanonicalReplaySeq,
      nextCanonicalTurnSeq,
      isLoading,
      newSession,
      openOverlay,
      resetStreamingBuffers,
      runtimeCwd,
      runtimeEnv,
      runtimeFlags,
      sessionSaveEnabled,
      setReplMode,
      userInput,
      onCompactLifecycle,
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
 
