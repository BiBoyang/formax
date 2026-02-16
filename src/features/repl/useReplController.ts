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
import { partitionMessages } from './controller/messages'
import { buildBashModeInjectedBlocks, getClaudeMdInjectionMeta } from './injectedBlocks'
import { useReplOverlays } from './controller/overlays'
import { useReplStreaming, type ExploreTaskBatch } from './controller/streaming'
import {
  appendCanonicalTurnFinalRows,
  canonicalTurnSegmentsToMessages,
  tailSegmentsForTurn,
} from './controller/canonicalTurnMessages'
import { isErrorLikeSubline } from './controller/errorSubline'
import { applyAbortToMessages } from './controller/abortTranscript'
import {
  buildPersistedSigMap,
  ensureSessionWriter as ensureSessionWriterInternal,
  openInitialSessionWriter as openInitialSessionWriterInternal,
  shouldPersistUiMsg,
  shutdownSessionWriter as shutdownSessionWriterInternal,
  startNewSessionWriter as startNewSessionWriterInternal,
  type SessionWriterRefs,
} from './controller/sessionLifecycle'
import {
  applyConfigExitInjection,
  getLocalCommandInjectionStats,
} from './controller/localCommandInjection'
import {
  resolvePreMainSendRouting,
  runMainSendTurn,
} from './controller/send'
import type { CompactLifecycleEvent } from './controller/compactFlow'
import { emitCanonicalUiMessageForTurn } from './controller/canonicalUiMessages'
import {
  applyLocalBashCompletionToMessages,
  createLocalBashCanonicalEmitter,
  formatBashModeOutput,
  isBashModeResultError,
  runBashModeCommand,
} from './controller/bashMode'
import { SessionWriter } from './sessionSave/writer'
import { readSessionFile } from './sessionSave/reader'
import { createRuntimeFlags, type RuntimeFlags } from '../../env/runtimeFlags'
import { extractLastAssistantTextFromHistory, maybeAutoGenerateSessionTitle } from '../sessionTitle'
import { resolveReplModeTransition, shouldInjectExitPlanReminder } from '../semantics/replModeTransition'
import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
} from '../semantics/transcriptProjection'
import type { CanonicalEvent } from '../semantics/canonicalEvents'

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
  const pendingExitPlanReminderRef = useRef(false)
  const reminderServiceRef = useRef<ReminderService | null>(null)
  const contextBudgetConfigRef = useRef<ContextBudgetConfig | null>(null)
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
  const pendingInjectedBlocksRef = useRef<PromptBlock[]>([])
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
        pendingInjectedBlocksRef,
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

  const resetSessionState = useCallback(() => {
    historyRef.current = []
    pendingInjectedBlocksRef.current = []
    pendingExitPlanReminderRef.current = false
    resetStreamingBuffers()
    setError(null)
    currentAssistantIdRef.current = null
    contextBudgetConfigRef.current = null
    runtimeStateRefs.sendSeqRef.current = 0
    runtimeStateRefs.autoCompactSeqRef.current = -1_000_000
    setContext(null)
    clearToolRuntimeState()
    canonicalRefs.projectionRef.current = createInitialTranscriptProjectionState({ threadId: CANONICAL_THREAD_ID })
    canonicalRefs.replaySeqRef.current = 0
    canonicalRefs.turnIdRef.current = null
    canonicalRefs.turnSeqRef.current = 0
    clearCanonicalTransientState()
    runtimeStateRefs.claudeMdMetaSigRef.current = null
  }, [clearCanonicalTransientState, clearToolRuntimeState, resetStreamingBuffers])

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
      pendingExitPlanReminderRef.current = true
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
    reminderServiceRef,
    contextBudgetConfigRef,
    canonical: {
      threadId: CANONICAL_THREAD_ID,
      getTurnId: () => canonicalRefs.turnIdRef.current,
      nextReplaySeq: nextCanonicalReplaySeq,
      onEvent: onCanonicalEvent,
    },
  })

  const abort = useCallback(() => {
    const hadInFlightRequest = Boolean(abortControllerRef.current) || isLoading
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    bashModeInFlightRef.current = false

    userInput?.clearBufferedAnswers()
    userInput?.rejectAllPending(new Error('Request aborted'))

    resetStreamingBuffers()
    clearCanonicalTransientState()
    setIsLoading(false)
    setError(null)
    const trackedRunningToolsSnapshot = Array.from(toolRuntimeRefs.nameByIdRef.current.entries())
    clearToolRuntimeState()

    if (currentAssistantIdRef.current) {
      const id = currentAssistantIdRef.current
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)))
      currentAssistantIdRef.current = null
    }

    setMessages((prev) => {
      return applyAbortToMessages({
        messages: prev,
        trackedRunningTools: trackedRunningToolsSnapshot,
        hadInFlightRequest,
      })
    })
  }, [clearCanonicalTransientState, clearToolRuntimeState, isLoading, resetStreamingBuffers, userInput])

  const newSession = useCallback(() => {
    deps.engine.beginNewSession?.({ source: 'clear' })
    if (sessionSaveEnabled) {
      const oldWriter = sessionWriterRef.current
      sessionWriterRef.current = null
      lastPersistedSigByMsgIdRef.current = new Map()
      void (async () => {
        if (!oldWriter) return
        await oldWriter.appendEvent('clear')
        await oldWriter.shutdown()
      })()
    }
    resetSessionState()

    // Ink <Static> is append-only; when clearing messages we must force a remount
    // so the new transcript starts from a fresh render surface.
    setTranscriptSeq((n) => n + 1)
    setMessages(() => [])
    // Clear the terminal *after* scheduling state resets, otherwise Ink may
    // re-render the old transcript once before the clear takes effect.
    void deps.onClearTerminal?.()

    if (sessionSaveEnabled) {
      // Coordinate writer initialization with ensureSessionWriter() so a fast
      // subsequent send() can't create a second, orphaned session writer.
      const promise = startNewSessionWriter().finally(() => {
        if (sessionWriterInitPromiseRef.current === promise) sessionWriterInitPromiseRef.current = null
      })
      sessionWriterInitPromiseRef.current = promise
      void promise
    }
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

      const provider = (deps.cfg.llm as any).provider === 'openai' ? 'openai' : 'anthropic'

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
        const bashAbort = new AbortController()
        abortControllerRef.current = bashAbort

        const localTurnId = `local-bash-${nextCanonicalTurnSeq()}`
        const msgId = `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`
        const localCanonicalEmitter = createLocalBashCanonicalEmitter({
          threadId: CANONICAL_THREAD_ID,
          turnId: localTurnId,
          toolUseId: msgId,
          onCanonicalEvent,
          nextReplaySeq: nextCanonicalReplaySeq,
        })
        setMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: 'tool',
            content: '',
            timestamp: new Date(),
            toolInfo: {
              name: 'LocalBash',
              input: { command },
              status: 'running',
            },
          },
        ])
        localCanonicalEmitter.emitUserMessage(command)
        localCanonicalEmitter.emitToolEvent({ phase: 'start' })
        localCanonicalEmitter.emitToolEvent({ phase: 'update', line: `$ ${command}` })

        try {
          const res = await runBashModeCommand({
            command,
            cwd: runtimeCwd,
            signal: bashAbort.signal,
            env: runtimeEnv,
            runtimeFlags,
          })

          // If the user aborted, `abort()` already marked running tool messages as error; don't overwrite.
          if (bashAbort.signal.aborted) {
            localCanonicalEmitter.emitToolEvent({ phase: 'end', summary: 'Error: Request aborted', isError: true })
            localCanonicalEmitter.emitFooter('interrupted', 'Request aborted')
            return
          }

          const outputText = formatBashModeOutput({
            stdout: res.stdout,
            stderr: res.stderr,
            timedOut: res.timedOut,
            exitCode: res.exitCode,
            exitSignal: res.exitSignal,
          })

          pendingInjectedBlocksRef.current.push(
            ...buildBashModeInjectedBlocks({
              input: command,
              stdout: res.stdout,
              stderr: res.stderr,
            }),
          )

          const isError = isBashModeResultError(res)
          setMessages((prev) =>
            applyLocalBashCompletionToMessages({
              messages: prev,
              messageId: msgId,
              command,
              outputText,
              isError,
            }),
          )
          localCanonicalEmitter.emitToolEvent({ phase: 'end', summary: outputText, isError })
          localCanonicalEmitter.emitFooter(isError ? 'failed' : 'completed')
        } finally {
          bashModeInFlightRef.current = false
          if (abortControllerRef.current === bashAbort) abortControllerRef.current = null
          clearCanonicalTransientState()
        }

        return
      }

      if (sessionSaveEnabled) {
        const promptProfile = deps.promptProfile ?? deps.cfg.ui.promptProfile
        if (promptProfile === 'full') {
          const meta = getClaudeMdInjectionMeta({ cwd: runtimeCwd, env: runtimeEnv })
          if (meta.global || meta.project) {
            const sig = JSON.stringify(meta)
            if (runtimeStateRefs.claudeMdMetaSigRef.current !== sig) {
              runtimeStateRefs.claudeMdMetaSigRef.current = sig
              void sessionWriterRef.current?.appendEvent('claude_md_injection', meta)
            }
          }
        }
      }

      const preMainRouting = await resolvePreMainSendRouting({
        text,
        preferredSlashSpecId: opts?.preferredSlashSpecId,
        isLoading,
        provider,
        engine: deps.engine,
        cfg: deps.cfg,
        promptProfile: deps.promptProfile,
        allowedSubagents,
        mode: deps.mode,
        getReplMode: () => modeRefs.currentRef.current,
        setReplMode,
        getPlanPath: () => deps.planSession?.getPlanPath() ?? null,
        historyRef,
        contextBudgetConfigRef,
        abortControllerRef,
        assistantBufferRef,
        thinkingBufferRef: thinkingRefs.bufferRef,
        thinkingLastFlushAtRef: thinkingRefs.lastFlushAtRef,
        currentAssistantIdRef,
        pendingInjectedBlocksRef,
        commandRegistry: deps.commandRegistry,
        openOverlay,
        closeOverlay,
        newSession,
        setMessages,
        setIsLoading,
        setLoadingText,
        setThinkingText,
        setError,
        setContext,
        handleEvent,
        onCompactLifecycle,
        onCompactRequested: () => {
          if (sessionSaveEnabled) void sessionWriterRef.current?.appendEvent('compact_requested')
        },
        onSlashLocalAsyncRecordForNextTurn: (rec) => {
          if (!sessionSaveEnabled) return
          const stats = getLocalCommandInjectionStats(rec)
          void sessionWriterRef.current?.appendEvent('local_command_injection', {
            source: 'slash_local_async',
            commandName: rec.commandName,
            ...stats,
          })
        },
        onSlashLocalRecordForNextTurn: (rec) => {
          if (!sessionSaveEnabled) return
          const stats = getLocalCommandInjectionStats(rec)
          void sessionWriterRef.current?.appendEvent('local_command_injection', {
            source: 'slash_local',
            commandName: rec.commandName,
            ...stats,
          })
        },
      })
      if (preMainRouting.shouldReturn) return
      const slashEffect = preMainRouting.slashEffect

      const canonicalTurnId = `turn-${nextCanonicalTurnSeq()}`
      canonicalRefs.turnIdRef.current = canonicalTurnId
      setCanonicalTransientActive(false)
      let turnUserMessageId: string | null = null
      let turnOutcome: 'completed' | 'aborted' | 'failed' = 'completed'
      try {
        const runResult = await runMainSendTurn({
          input: { text, slashEffect, provider },
          deps: {
            engine: deps.engine,
            cfg: deps.cfg,
            promptProfile: deps.promptProfile,
            planSession: deps.planSession ?? null,
            reminderServiceRef,
            tools: deps.tools,
            allowedSubagents,
            mode: deps.mode,
            getReplMode: () => modeRefs.currentRef.current,
            setReplMode,
            handleEvent,
          },
          refs: {
            historyRef,
            pendingInjectedBlocksRef,
            pendingExitPlanReminderRef,
            contextBudgetConfigRef,
            abortControllerRef,
            assistantBufferRef,
            thinkingBufferRef: thinkingRefs.bufferRef,
            thinkingLastFlushAtRef: thinkingRefs.lastFlushAtRef,
            currentAssistantIdRef,
            sendSeqRef: runtimeStateRefs.sendSeqRef,
            lastAutoCompactSeqRef: runtimeStateRefs.autoCompactSeqRef,
            onCompactLifecycle,
          },
          state: {
            setMessages,
            setIsLoading,
            setLoadingText,
            setThinkingText,
            setError,
            setContext,
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
 
