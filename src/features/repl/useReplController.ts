import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { TokenUsage } from '../../streaming/types'
import type { Msg } from '../../components/tool/ToolMessage'
import type { PromptBlock } from '../../prompts'
import type { ReplMode } from './mode'
import type { LocalCommandRecord, SlashCommandEffect, SlashCommandRegistry } from '../commands/registry'
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
import { isExactSlashCommand } from './controller/utils'
import { partitionMessages } from './controller/messages'
import { buildLocalCommandInjectedBlocks, getClaudeMdInjectionMeta } from './injectedBlocks'
import { useReplOverlays } from './controller/overlays'
import { useReplStreaming, type ExploreTaskBatch } from './controller/streaming'
import {
  maybeHandleClearCommand,
  maybeHandleCompactCommand,
  maybeHandleConsumedSlashCommand,
  runMainSendTurn,
} from './controller/send'
import { SessionWriter } from './sessionSave/writer'
import { readSessionFile } from './sessionSave/reader'

function shouldPersistUiMsg(msg: Msg): boolean {
  if (msg.isStreaming) return false
  if (msg.role === 'tool' && msg.toolInfo?.status === 'running') return false
  return true
}

function getLocalCommandInjectionStats(rec: LocalCommandRecord): {
  stdoutChars: number
  stdoutBytes: number
  injectedChars: number
  injectedBlocks: number
} {
  const blocks = buildLocalCommandInjectedBlocks(rec)
  const injectedChars = blocks.reduce((sum, b) => sum + (typeof (b as any).text === 'string' ? (b as any).text.length : 0), 0)
  return {
    stdoutChars: rec.stdout.length,
    stdoutBytes: Buffer.byteLength(rec.stdout, 'utf8'),
    injectedChars,
    injectedBlocks: blocks.length,
  }
}

function buildPersistedSigMap(messages: Msg[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const msg of messages) {
    if (!shouldPersistUiMsg(msg)) continue
    map.set(msg.id, JSON.stringify(msg))
  }
  return map
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
  thinkingTotalMs: number
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
    resetTranscriptSurface: () => void
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
}): ReplController {
  const [messages, setMessages] = useState<Msg[]>(() => deps.initialSession?.messages ?? [])
  const [transcriptSeq, setTranscriptSeq] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Thinking')
  const [thinkingText, setThinkingText] = useState('')
  const [thinkingStartedAtMs, setThinkingStartedAtMs] = useState<number | null>(null)
  const [thinkingTotalMs, setThinkingTotalMs] = useState(0)
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
    projectAgentsDir: deps.cfg.paths.subagentsDir,
    reloadSubagents: deps.reloadSubagents,
    setAllowedSubagents,
    setMessages,
    initialOverlay: process.env.FORMAX_START_AGENTS_DIALOG === '1' ? { kind: 'agents' } : null,
  })

  const assistantTextMode = deps.cfg.ui.assistantTextMode
  const historyRef = useRef<ChatHistory>(deps.initialSession?.history ?? [])
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)
  const assistantBufferRef = useRef<string>('')
  const thinkingBufferRef = useRef<string>('')
  const currentThinkingMessageIdRef = useRef<string | null>(null)
  const thinkingLastFlushAtRef = useRef(0)
  const thinkingTimingRef = useRef<{ startedAtMs: number | null; totalMs: number }>({
    startedAtMs: null,
    totalMs: 0,
  })
  const toolNameByIdRef = useRef<Map<string, string>>(new Map())
  const toolInputByIdRef = useRef<Map<string, unknown>>(new Map())
  const taskStatsByToolUseIdRef = useRef<
    Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>
  >(new Map())
  const taskKindByToolUseIdRef = useRef<Map<string, 'explore' | 'other'>>(new Map())
  const exploreBatchRef = useRef<ExploreTaskBatch | null>(null)
  const modeRef = useRef<ReplMode>(deps.mode)
  const prevModeRef = useRef<ReplMode>(deps.mode)
  const pendingExitPlanReminderRef = useRef(false)
  const reminderServiceRef = useRef<ReminderService | null>(null)
  const contextBudgetConfigRef = useRef<ContextBudgetConfig | null>(null)
  const sendSeqRef = useRef(0)
  const sessionWriterRef = useRef<SessionWriter | null>(null)
  const sessionWriterInitPromiseRef = useRef<Promise<void> | null>(null)
  const lastPersistedSigByMsgIdRef = useRef<Map<string, string>>(new Map())
  const prevIsLoadingRef = useRef(false)
  const lastClaudeMdMetaSigRef = useRef<string | null>(null)

  const sessionSaveEnabled = useMemo(() => {
    const raw = String(process.env.FORMAX_SESSION_SAVE ?? '').trim().toLowerCase()
    const disabled = String(process.env.FORMAX_SESSION_SAVE_DISABLED ?? '').trim().toLowerCase()
    if (disabled === '1' || disabled === 'true' || disabled === 'yes') return false
    if (!raw) return true
    if (raw === '0' || raw === 'false' || raw === 'no') return false
    return true
  }, [])
  const lastAutoCompactSeqRef = useRef(-1_000_000)
  const userInput = useUserInputManager()
  const pendingInjectedBlocksRef = useRef<PromptBlock[]>([])
  const startNewSessionWriter = useCallback(async (): Promise<void> => {
    if (!sessionSaveEnabled) return
    const { writer } = await SessionWriter.createNew({
      cwd: process.cwd(),
      env: process.env,
      model: deps.cfg.llm.model,
    })
    sessionWriterRef.current = writer
    lastPersistedSigByMsgIdRef.current = new Map()
    await writer.appendHistorySnapshot(historyRef.current)
  }, [deps.cfg.llm.model, sessionSaveEnabled])

  const openInitialSessionWriter = useCallback(async (): Promise<void> => {
    if (!sessionSaveEnabled) return
    if (sessionWriterRef.current) return
    const filePath = deps.initialSession?.filePath
    if (!filePath) {
      await startNewSessionWriter()
      return
    }

    const writer = await SessionWriter.openExisting({ filePath })
    sessionWriterRef.current = writer
    // Avoid duplicating the whole transcript when resuming: the messages state
    // is already loaded from this session file, so mark them as already persisted.
    lastPersistedSigByMsgIdRef.current = buildPersistedSigMap(deps.initialSession?.messages ?? [])
    await writer.appendEvent('resume')
    await writer.appendHistorySnapshot(historyRef.current)
  }, [deps.initialSession?.filePath, deps.initialSession?.messages, sessionSaveEnabled, startNewSessionWriter])

  const shutdownSessionWriter = useCallback(async (): Promise<void> => {
    const writer = sessionWriterRef.current
    sessionWriterRef.current = null
    if (!writer) return
    await writer.shutdown()
  }, [])

  useEffect(() => {
    return () => {
      if (!sessionSaveEnabled) return
      void shutdownSessionWriter()
    }
  }, [sessionSaveEnabled, shutdownSessionWriter])

  const ensureSessionWriter = useCallback(async (): Promise<void> => {
    if (!sessionSaveEnabled) return
    if (sessionWriterRef.current) return
    const inflight = sessionWriterInitPromiseRef.current
    if (inflight) {
      await inflight
      return
    }
    const promise = openInitialSessionWriter()
      .finally(() => {
        sessionWriterInitPromiseRef.current = null
      })
    sessionWriterInitPromiseRef.current = promise
    await promise
  }, [openInitialSessionWriter, sessionSaveEnabled])

  const closeConfigDialogWithInjection = useCallback(
    (exit: ConfigDialogExit) => {
      closeConfigDialog(exit)
      if (sessionSaveEnabled) {
        void sessionWriterRef.current?.appendEvent('config_exit', {
          kind: exit.kind,
          message: exit.message,
        })
      }

      // `/config` only injects into the next request when the change affects prompt semantics.
      // For v0, that's only Output style.
      if (exit.kind === 'changed' && exit.message.startsWith('Set output style to ')) {
        const rec: LocalCommandRecord = {
          commandName: '/config',
          commandMessage: 'config',
          commandArgs: '',
          stdout: exit.message,
        }
        const stats = getLocalCommandInjectionStats(rec)
        const styleLabel = exit.message.replace(/^Set output style to\s+/, '').trim()
        const styleId = styleLabel.toLowerCase()

        if (sessionSaveEnabled) {
          void sessionWriterRef.current?.appendEvent('output_style_changed', {
            style: styleId,
            label: styleLabel,
            ...stats,
          })
          void sessionWriterRef.current?.appendEvent('local_command_injection', {
            source: 'config_output_style',
            commandName: rec.commandName,
            ...stats,
          })
        }

        pendingInjectedBlocksRef.current.push(...buildLocalCommandInjectedBlocks(rec))
      }
    },
    [closeConfigDialog, sessionSaveEnabled],
  )

  const resetStreamingBuffers = useCallback(() => {
    assistantBufferRef.current = ''
    thinkingBufferRef.current = ''
    currentThinkingMessageIdRef.current = null
    thinkingLastFlushAtRef.current = 0
    thinkingTimingRef.current = { startedAtMs: null, totalMs: 0 }
    setThinkingText('')
    setThinkingStartedAtMs(null)
    setThinkingTotalMs(0)
  }, [])

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
    lastClaudeMdMetaSigRef.current = null
  }, [resetStreamingBuffers])

  useEffect(() => {
    setAllowedSubagents(deps.allowedSubagents ?? [])
  }, [deps.allowedSubagents])

  useEffect(() => {
    modeRef.current = deps.mode
    const prev = prevModeRef.current
    if (prev === 'plan' && deps.mode !== 'plan') {
      pendingExitPlanReminderRef.current = true
    }
    prevModeRef.current = deps.mode
  }, [deps.mode])

  useEffect(() => {
    if (!sessionSaveEnabled) return
    // Avoid altering Vitest's process-level behavior (it relies on these signals/exceptions).
    if (String(process.env.VITEST || '').trim()) return

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
  }, [sessionSaveEnabled])

  const setReplMode = useCallback(
    (nextMode: ReplMode) => {
      modeRef.current = nextMode
      deps.onModeChange?.(nextMode)
    },
    [deps.onModeChange],
  )

  const { staticMessages, transientMessages } = useMemo(() => {
    return partitionMessages(messages)
  }, [messages])

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
      const lastUserPrompt = (() => {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]
          if (m.role !== 'user') continue
          const t = String(m.content ?? '').trim()
          if (t) return t
        }
        return null
      })()
      void writer.appendEvent('ui_stats', { uiMsgCount, lastUserPrompt })
    }
  }, [isLoading, messages])

  const { handleEvent } = useReplStreaming({
    assistantTextMode,
    setMessages,
    setThinkingText,
    setThinkingStartedAtMs,
    setThinkingTotalMs,
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
  })

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null

    userInput?.clearBufferedAnswers()
    userInput?.rejectAllPending(new Error('Request aborted'))

    resetStreamingBuffers()
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
      void startNewSessionWriter()
    }
  }, [deps.onClearTerminal, resetSessionState, sessionSaveEnabled, startNewSessionWriter])

  const resetTranscriptSurface = useCallback(() => {
    // Ink <Static> is append-only; forcing a remount gives us a fresh render surface.
    setTranscriptSeq((n) => n + 1)
    void deps.onClearTerminal?.()
  }, [deps.onClearTerminal])

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
      if (!text || isLoading) return

      const provider = (deps.cfg.llm as any).provider === 'openai' ? 'openai' : 'anthropic'

      // Thinking/streaming state is per-turn; clear buffers so stale thinking
      // from previous turns can't leak into the next status line/panel.
      resetStreamingBuffers()

      await ensureSessionWriter()

      if (sessionSaveEnabled) {
        const promptProfile = deps.promptProfile ?? deps.cfg.ui.promptProfile
        if (promptProfile === 'full') {
          const meta = getClaudeMdInjectionMeta({ cwd: process.cwd(), env: process.env })
          if (meta.global || meta.project) {
            const sig = JSON.stringify(meta)
            if (lastClaudeMdMetaSigRef.current !== sig) {
              lastClaudeMdMetaSigRef.current = sig
              void sessionWriterRef.current?.appendEvent('claude_md_injection', meta)
            }
          }
        }
      }

      if (
        maybeHandleClearCommand({
          text,
          isLoading,
          setMessages,
          newSession,
        })
      ) {
        return
      }

      if (isExactSlashCommand(text, '/compact')) {
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
        })
        return
      }

      let slashEffect: SlashCommandEffect | null = null
      if (text.startsWith('/')) {
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

      await runMainSendTurn({
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
      setReplMode,
      userInput,
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
      thinkingTotalMs,
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
 
