import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { TokenUsage } from '../../streaming/types'
import type { Msg } from '../../components/tool/ToolMessage'
import type { PromptBlock } from '../../prompts'
import type { ReplMode } from './mode'
import type { SlashCommandEffect, SlashCommandRegistry } from '../commands/registry'
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
import { resolveCommandRouting } from '../semantics/commandRouting'
import { partitionMessages } from './controller/messages'
import { buildBashModeInjectedBlocks, getClaudeMdInjectionMeta } from './injectedBlocks'
import { useReplOverlays } from './controller/overlays'
import { useReplStreaming, type ExploreTaskBatch } from './controller/streaming'
import { canonicalTurnSegmentsToMessages, replaceTurnTailWithCanonicalMessages } from './controller/canonicalTurnMessages'
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
  maybeHandleClearCommand,
  maybeHandleCompactCommand,
  maybeHandleConsumedSlashCommand,
  runMainSendTurn,
} from './controller/send'
import type { CompactLifecycleEvent } from './controller/compactFlow'
import { formatBashModeOutput, runBashModeCommand } from './controller/bashMode'
import { SessionWriter } from './sessionSave/writer'
import { readSessionFile } from './sessionSave/reader'
import { createRuntimeFlags, type RuntimeFlags } from '../../env/runtimeFlags'
import { extractLastAssistantTextFromHistory, maybeAutoGenerateSessionTitle } from '../sessionTitle'
import { resolveReplModeTransition, shouldInjectExitPlanReminder } from '../semantics/replModeTransition'
import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
  type TranscriptSegment,
} from '../semantics/transcriptProjection'
import type { CanonicalEvent } from '../semantics/canonicalEvents'

function waitForNextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function tailSegmentsForTurn(segments: TranscriptSegment[], turnId: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  let seenTurn = false

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (!segment) continue
    if (segment.turnId === turnId) {
      out.push(segment)
      seenTurn = true
      continue
    }
    if (seenTurn) break
  }

  return out.reverse()
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
  const thinkingBufferRef = useRef<string>('')
  const currentThinkingMessageIdRef = useRef<string | null>(null)
  const thinkingLastFlushAtRef = useRef(0)
  const thinkingTimingRef = useRef<{ startedAtMs: number | null }>({
    startedAtMs: null,
  })
  const toolNameByIdRef = useRef<Map<string, string>>(new Map())
  const toolInputByIdRef = useRef<Map<string, unknown>>(new Map())
  const taskStatsByToolUseIdRef = useRef<
    Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>
  >(new Map())
  const taskKindByToolUseIdRef = useRef<Map<string, 'explore' | 'other'>>(new Map())
  const exploreBatchRef = useRef<ExploreTaskBatch | null>(null)
  const canonicalProjectionRef = useRef(createInitialTranscriptProjectionState({ threadId: 'tui-live' }))
  const canonicalReplaySeqRef = useRef(0)
  const canonicalTurnIdRef = useRef<string | null>(null)
  const canonicalTurnSeqRef = useRef(0)
  const modeRef = useRef<ReplMode>(deps.mode)
  const prevModeRef = useRef<ReplMode>(deps.mode)
  const pendingExitPlanReminderRef = useRef(false)
  const reminderServiceRef = useRef<ReminderService | null>(null)
  const contextBudgetConfigRef = useRef<ContextBudgetConfig | null>(null)
  const sendSeqRef = useRef(0)
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
  const prevIsLoadingRef = useRef(false)
  const lastClaudeMdMetaSigRef = useRef<string | null>(null)
  const surfaceOpQueueRef = useRef<Promise<void>>(Promise.resolve())
  const autoTitleAttemptedSessionIdsRef = useRef<Set<string>>(new Set())
  const autoTitleCheckedTopicPromptKeysRef = useRef<Set<string>>(new Set())

  const sessionSaveEnabled = runtimeFlags.sessionSaveEnabled
  const lastAutoCompactSeqRef = useRef(-1_000_000)
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
    thinkingBufferRef.current = ''
    currentThinkingMessageIdRef.current = null
    thinkingLastFlushAtRef.current = 0
    thinkingTimingRef.current = { startedAtMs: null }
    setThinkingText('')
    setThinkingStartedAtMs(null)
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
    sendSeqRef.current = 0
    lastAutoCompactSeqRef.current = -1_000_000
    setContext(null)
    toolNameByIdRef.current.clear()
    toolInputByIdRef.current.clear()
    taskStatsByToolUseIdRef.current.clear()
    taskKindByToolUseIdRef.current.clear()
    exploreBatchRef.current = null
    canonicalProjectionRef.current = createInitialTranscriptProjectionState({ threadId: 'tui-live' })
    canonicalReplaySeqRef.current = 0
    canonicalTurnIdRef.current = null
    canonicalTurnSeqRef.current = 0
    setCanonicalTurnMessages([])
    setCanonicalTransientActive(false)
    lastClaudeMdMetaSigRef.current = null
  }, [resetStreamingBuffers])

  const onCanonicalEvent = useCallback((event: CanonicalEvent) => {
    canonicalProjectionRef.current = reduceTranscriptProjection(canonicalProjectionRef.current, event)
    setCanonicalTransientActive(true)
    const turnId = canonicalTurnIdRef.current ?? event.turnId
    const turnTailSegments = tailSegmentsForTurn(canonicalProjectionRef.current.segments, turnId)
    setCanonicalTurnMessages(
      canonicalTurnSegmentsToMessages({
        turnId,
        segments: turnTailSegments,
        transientOnly: true,
        openAssistantSegmentId: canonicalProjectionRef.current.openAssistantSegmentIdByTurn[turnId],
        includeAssistantStreaming: assistantTextMode === 'stream',
      }),
    )
    if (event.kind === 'turn_footer') {
      canonicalTurnIdRef.current = null
    }
  }, [assistantTextMode])

  useEffect(() => {
    setAllowedSubagents(deps.allowedSubagents ?? [])
  }, [deps.allowedSubagents])

  useEffect(() => {
    modeRef.current = deps.mode
    const prev = prevModeRef.current
    if (shouldInjectExitPlanReminder({ current: prev, next: deps.mode })) {
      pendingExitPlanReminderRef.current = true
    }
    prevModeRef.current = deps.mode
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
      const transition = resolveReplModeTransition({ current: modeRef.current, next: nextMode })
      if (!transition) return
      modeRef.current = transition.to
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
    const wasLoading = prevIsLoadingRef.current
    prevIsLoadingRef.current = isLoading
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
        attemptedSessionIds: autoTitleAttemptedSessionIdsRef.current,
        checkedTopicPromptKeys: autoTitleCheckedTopicPromptKeysRef.current,
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
    thinkingBufferRef,
    currentThinkingMessageIdRef,
    thinkingLastFlushAtRef,
    thinkingTimingRef,
    toolNameByIdRef,
    toolInputByIdRef,
    taskStatsByToolUseIdRef,
    taskKindByToolUseIdRef,
    exploreBatchRef,
    reminderServiceRef,
    contextBudgetConfigRef,
    canonical: {
      threadId: 'tui-live',
      getTurnId: () => canonicalTurnIdRef.current,
      nextReplaySeq: () => {
        canonicalReplaySeqRef.current += 1
        return canonicalReplaySeqRef.current
      },
      onEvent: onCanonicalEvent,
    },
  })

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    bashModeInFlightRef.current = false

    userInput?.clearBufferedAnswers()
    userInput?.rejectAllPending(new Error('Request aborted'))

    resetStreamingBuffers()
    setCanonicalTurnMessages([])
    setCanonicalTransientActive(false)
    setIsLoading(false)
    setError(null)

    if (currentAssistantIdRef.current) {
      const id = currentAssistantIdRef.current
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)))
      currentAssistantIdRef.current = null
    }

    setMessages((prev) => {
      const abortedAt = Date.now()
      const abortResult = 'Error: Request aborted'

      const markAborted = (m: Msg): Msg => {
        if (m.role !== 'tool' || !m.toolInfo || m.toolInfo.status !== 'running') return m
        return {
          ...m,
          content: abortResult,
          toolInfo: {
            ...m.toolInfo,
            status: 'error',
            result: abortResult,
          },
        }
      }

      const isAskRunning = (m: Msg) =>
        m.role === 'tool' && m.toolInfo?.name === 'AskUserQuestion' && m.toolInfo?.status === 'running'

      const hadAsk = prev.some(isAskRunning)
      const next = prev.map(markAborted)

      if (hadAsk) {
        next.push({
          id: `assistant-${abortedAt}`,
          role: 'assistant',
          content: 'User declined to answer questions',
          timestamp: new Date(),
        })
      }

      return next
    })
  }, [resetStreamingBuffers, userInput])

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
    const next = surfaceOpQueueRef.current.catch(() => undefined).then(op)
    surfaceOpQueueRef.current = next.catch(() => undefined)
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

        const msgId = `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`
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

        try {
          const res = await runBashModeCommand({
            command,
            cwd: runtimeCwd,
            signal: bashAbort.signal,
            env: runtimeEnv,
            runtimeFlags,
          })

          // If the user aborted, `abort()` already marked running tool messages as error; don't overwrite.
          if (bashAbort.signal.aborted) return

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

          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== msgId) return m
              if (m.role !== 'tool' || m.toolInfo?.status !== 'running') return m

              const isError =
                res.timedOut ||
                Boolean(res.exitSignal) ||
                (typeof res.exitCode === 'number' && res.exitCode !== 0)

              return {
                ...m,
                content: `$ ${command}`,
                toolInfo: {
                  ...(m.toolInfo || { name: 'LocalBash', input: { command } }),
                  name: 'LocalBash',
                  input: { command },
                  status: isError ? 'error' : 'completed',
                  result: outputText,
                },
              }
            }),
          )
        } finally {
          bashModeInFlightRef.current = false
          if (abortControllerRef.current === bashAbort) abortControllerRef.current = null
        }

        return
      }

      if (sessionSaveEnabled) {
        const promptProfile = deps.promptProfile ?? deps.cfg.ui.promptProfile
        if (promptProfile === 'full') {
          const meta = getClaudeMdInjectionMeta({ cwd: runtimeCwd, env: runtimeEnv })
          if (meta.global || meta.project) {
            const sig = JSON.stringify(meta)
            if (lastClaudeMdMetaSigRef.current !== sig) {
              lastClaudeMdMetaSigRef.current = sig
              void sessionWriterRef.current?.appendEvent('claude_md_injection', meta)
            }
          }
        }
      }

      const commandRouting = resolveCommandRouting(text)

      if (
        commandRouting.isExactClear &&
        maybeHandleClearCommand({
          text,
          isLoading,
          setMessages,
          newSession,
        })
      ) {
        return
      }

      if (commandRouting.isExactCompact) {
        if (sessionSaveEnabled) void sessionWriterRef.current?.appendEvent('compact_requested')
        await maybeHandleCompactCommand({
          text,
          provider,
          engine: deps.engine,
          cfg: deps.cfg,
          promptProfile: deps.promptProfile,
          allowedSubagents,
          mode: deps.mode,
          getReplMode: () => modeRef.current,
          setReplMode,
          getPlanPath: () => deps.planSession?.getPlanPath() ?? null,
          historyRef,
          contextBudgetConfigRef,
          abortControllerRef,
          assistantBufferRef,
          thinkingBufferRef,
          thinkingLastFlushAtRef,
          currentAssistantIdRef,
          setMessages,
          setIsLoading,
          setLoadingText,
          setThinkingText,
          setError,
          setContext,
          handleEvent,
          onCompactLifecycle,
        })
        return
      }

      let slashEffect: SlashCommandEffect | null = null
      if (commandRouting.isSlashCommand) {
        const res = await maybeHandleConsumedSlashCommand({
          text,
          preferredSlashSpecId: opts?.preferredSlashSpecId,
          commandRegistry: deps.commandRegistry,
          openOverlay,
          closeOverlay,
          pendingInjectedBlocksRef,
          onLocalCommandRecordForNextTurn: (rec) => {
            if (!sessionSaveEnabled) return
            const stats = getLocalCommandInjectionStats(rec)
            void sessionWriterRef.current?.appendEvent('local_command_injection', {
              source: 'slash_local_async',
              commandName: rec.commandName,
              ...stats,
            })
          },
          thinkingBufferRef,
          thinkingLastFlushAtRef,
          currentAssistantIdRef,
          setMessages,
          setIsLoading,
          setLoadingText,
          setThinkingText,
          setError,
        })
        slashEffect = res.slashEffect
        if (sessionSaveEnabled && slashEffect?.kind === 'local' && slashEffect.recordForNextTurn) {
          const rec = slashEffect.recordForNextTurn
          const stats = getLocalCommandInjectionStats(rec)
          void sessionWriterRef.current?.appendEvent('local_command_injection', {
            source: 'slash_local',
            commandName: rec.commandName,
            ...stats,
          })
        }
        if (res.shouldReturn) return
      }

      canonicalTurnSeqRef.current += 1
      const canonicalTurnId = `turn-${canonicalTurnSeqRef.current}`
      canonicalTurnIdRef.current = canonicalTurnId
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
            getReplMode: () => modeRef.current,
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
            thinkingBufferRef,
            thinkingLastFlushAtRef,
            currentAssistantIdRef,
            sendSeqRef,
            lastAutoCompactSeqRef,
            onCompactLifecycle,
          },
          state: {
            setMessages,
            setIsLoading,
            setLoadingText,
            setThinkingText,
            setError,
            setContext,
          },
        })
        turnUserMessageId = runResult.userMessageId
        turnOutcome = runResult.turnOutcome
      } finally {
        if (turnUserMessageId && turnOutcome === 'completed') {
          const turnSegments = tailSegmentsForTurn(canonicalProjectionRef.current.segments, canonicalTurnId)
          const canonicalFinalMessages = canonicalTurnSegmentsToMessages({
            turnId: canonicalTurnId,
            segments: turnSegments,
          })
          if (canonicalFinalMessages.length > 0) {
            setMessages((prev) =>
              replaceTurnTailWithCanonicalMessages({
                messages: prev,
                userMessageId: turnUserMessageId,
                canonicalTurnMessages: canonicalFinalMessages,
              }),
            )
          }
        }
        canonicalTurnIdRef.current = null
        setCanonicalTurnMessages([])
        setCanonicalTransientActive(false)
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
      handleEvent,
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
      closeResumeDialog,
      resumeSession,
      renameSession,
      generateAgentDraft,
      saveAgentFromDialog,
    },
  }
}
 
