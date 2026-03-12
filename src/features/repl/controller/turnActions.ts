import type { Dispatch, SetStateAction } from 'react'
import type { StreamEvent } from '../../../streaming/types'
import type { ChatEngine, ChatHistory } from '../../../chat/engine'
import type { ToolDefinition } from '../../../tools/types'
import type { RuntimeConfig } from '../../../config/config'
import type { Msg } from '../../../shared/toolMessageTypes'
import type { PromptBlock } from '../../../prompts'
import type { ReplMode } from '../mode'
import type { SlashCommandRegistry, LocalCommandRecord } from '../../commands/registry'
import type { PlanSessionManager } from '../planSession'
import type { RuntimeFlags } from '../../../config/runtimeFlags'
import type { UserInputManager } from '../../../tools/runtime/userInputManager'
import type { CompactLifecycleEvent } from './send/compactFlow'
import type { CanonicalEvent } from '../../semantics/core'
import type { OverlaySpec } from '../../commands/contracts'
import type { ReminderService } from '../reminders/ReminderService'
import type { ContextBudgetConfig } from '../../../chat/context/budget'
import { resolveTurnProvider } from './shared'
import { maybeHandleClearCommand } from './send/send'
import { runLocalBashTurn } from './send/bashMode'
import { runReplModelSendFlow } from './send/sendOrchestration'
import { createSendTurnContext } from './send/sendTypes'
import { emitCanonicalTurnFooterForTurn, emitCanonicalUiMessageForTurn } from './canonical'
import {
  hasRunningAskTool,
  shouldBlockSendWhileBusy,
} from './send/turnGuards'
import { recordClaudeMdInjectionEvent } from './session'
import { toPersistedAppToolEventData } from '../sessionSave/appToolEventPayload'
import { runAbortSessionTransition } from './session'
import { SessionWriter } from '../sessionSave/writer'

type CanonicalTransientSnapshot = { turnId: string; includeAssistantStreaming: boolean; messages: Msg[] } | null

export function runAbortAction(args: {
  canonicalThreadId: string
  canonicalTurnIdRef: { current: string | null }
  canonicalTransientSnapshotRef: { current: CanonicalTransientSnapshot }
  toolNameByIdRef: { current: Map<string, string> }
  isLoading: boolean
  abortControllerRef: { current: AbortController | null }
  bashModeInFlightRef: { current: boolean }
  userInput: UserInputManager | null | undefined
  resetSessionUiState: () => void
  clearCanonicalTransientState: () => void
  clearToolRuntimeState: () => void
  currentAssistantIdRef: { current: string | null }
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  nextCanonicalReplaySeq: () => number
  onCanonicalEvent: (event: CanonicalEvent) => void
}): void {
  const canonicalTurnId = args.canonicalTurnIdRef.current
  if (canonicalTurnId) {
    const trackedRunningToolsSnapshot = Array.from(args.toolNameByIdRef.current.entries())
    const hadInFlightRequest = Boolean(args.abortControllerRef.current) || args.isLoading

    args.abortControllerRef.current?.abort()
    args.abortControllerRef.current = null
    args.bashModeInFlightRef.current = false

    args.userInput?.clearBufferedAnswers()
    args.userInput?.rejectAllPending(new Error('Request aborted'))

    args.resetSessionUiState()
    args.setIsLoading(false)
    args.clearToolRuntimeState()

    emitCanonicalTurnFooterForTurn({
      threadId: args.canonicalThreadId,
      turnId: canonicalTurnId,
      status: 'interrupted',
      message: 'Request aborted',
      nextReplaySeq: args.nextCanonicalReplaySeq,
      onCanonicalEvent: args.onCanonicalEvent,
    })

    const hadAsk = hasRunningAskTool({
      trackedRunningToolsSnapshot,
      transientSnapshot: args.canonicalTransientSnapshotRef.current,
    })

    if (hadAsk && hadInFlightRequest) {
      emitCanonicalUiMessageForTurn({
        threadId: args.canonicalThreadId,
        turnId: canonicalTurnId,
        message: { role: 'assistant', content: 'User declined to answer questions' },
        nextReplaySeq: args.nextCanonicalReplaySeq,
        onCanonicalEvent: args.onCanonicalEvent,
      })
    }

    args.clearCanonicalTransientState()
    return
  }

  runAbortSessionTransition({
    isLoading: args.isLoading,
    abortControllerRef: args.abortControllerRef,
    bashModeInFlightRef: args.bashModeInFlightRef,
    toolNameByIdRef: args.toolNameByIdRef,
    userInput: args.userInput,
    resetSessionUiState: args.resetSessionUiState,
    clearCanonicalTransientState: args.clearCanonicalTransientState,
    clearToolRuntimeState: args.clearToolRuntimeState,
    currentAssistantIdRef: args.currentAssistantIdRef,
    setMessages: args.setMessages,
    setIsLoading: args.setIsLoading,
  })
}

export async function runSendAction(args: {
  value: string
  opts?: { preferredSlashSpecId?: string }
  canonicalThreadId: string
  isLoading: boolean
  bashModeInFlightRef: { current: boolean }
  sessionTransitionPendingCountRef: { current: number }
  cfg: RuntimeConfig
  mode: ReplMode
  engine: ChatEngine
  planSession?: PlanSessionManager
  commandRegistry?: SlashCommandRegistry
  tools: ToolDefinition[]
  runtimeFlags: RuntimeFlags
  runtimeCwd: string
  runtimeEnv: NodeJS.ProcessEnv
  allowedSubagents: Array<{ name: string; description: string }>
  sessionSaveEnabled: boolean
  sessionWriterRef: { current: SessionWriter | null }
  ensureSessionWriter: () => Promise<void>
  runNewSession: () => Promise<void>
  resetStreamingBuffers: () => void
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  setLoadingText: Dispatch<SetStateAction<string>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
  setContext: Dispatch<SetStateAction<{ usedTokens: number; limitTokens: number; percentRemaining: number; source: 'estimate' | 'usage' } | null>>
  modeCurrentRef: { current: ReplMode }
  setReplMode: (nextMode: ReplMode) => void
  historyRef: { current: ChatHistory }
  pendingInjectedBlocksRef: { current: PromptBlock[] }
  contextBudgetConfigRef: { current: ContextBudgetConfig | null }
  abortControllerRef: { current: AbortController | null }
  assistantBufferRef: { current: string }
  thinkingBufferRef: { current: string }
  thinkingLastFlushAtRef: { current: number }
  currentAssistantIdRef: { current: string | null }
  pendingExitPlanReminderRef: { current: boolean }
  deferredToolExposureSessionKeyRef: { current: string }
  sendSeqRef: { current: number }
  autoCompactSeqRef: { current: number }
  reminderServiceRef: { current: ReminderService | null }
  canonicalTurnIdRef: { current: string | null }
  clearCanonicalTransientState: () => void
  setCanonicalTransientActive: Dispatch<SetStateAction<boolean>>
  nextCanonicalTurnSeq: () => number
  nextCanonicalReplaySeq: () => number
  onCanonicalEvent: (event: CanonicalEvent) => void
  onCompactLifecycle: (event: CompactLifecycleEvent) => void
  onCompactRequested: () => void
  onSlashLocalAsyncRecordForNextTurn: (record: LocalCommandRecord) => void
  onSlashLocalRecordForNextTurn: (record: LocalCommandRecord) => void
  openOverlay: (spec: OverlaySpec) => void
  closeOverlay: () => void
  handleEvent: (ev: StreamEvent) => void
  claudeMdMetaSigRef: { current: string | null }
  appendEmptyBashUsageMessage: () => void
  appendLocalBashCanonicalTail: (args: {
    localTurnId: string
    localTurnOutcome: 'completed' | 'failed' | 'aborted'
  }) => void
}): Promise<void> {
  const text = args.value.trim()
  if (
    shouldBlockSendWhileBusy({
      text,
      isLoading: args.isLoading,
      bashModeInFlight: args.bashModeInFlightRef.current,
      sessionTransitionPendingCount: args.sessionTransitionPendingCountRef.current,
    })
  ) {
    return
  }

  let provider: 'openai' | 'anthropic' = 'anthropic'
  let providerError: string | null = null
  try {
    provider = resolveTurnProvider(args.cfg.llm.provider)
  } catch (error) {
    providerError = error instanceof Error ? error.message : 'Unsupported provider'
  }

  // Thinking/streaming state is per-turn; clear buffers so stale thinking
  // from previous turns can't leak into the next status line/panel.
  args.resetStreamingBuffers()

  const didHandleClear = await maybeHandleClearCommand({
    text,
    isLoading: args.isLoading,
    setMessages: args.setMessages,
    newSession: args.runNewSession,
  })
  if (didHandleClear) return

  await args.ensureSessionWriter()

  // Bash mode (`!` prefix): run a local shell command without involving the LLM.
  // The command + output are injected into the *next* real turn.
  if (text.startsWith('!')) {
    const command = text.replace(/^!\s*/, '').trim()
    if (!command) {
      args.appendEmptyBashUsageMessage()
      return
    }

    // Treat bash-mode as an in-flight operation: prevent overlapping sends and allow Ctrl+C to abort.
    // We intentionally avoid the LLM "isLoading" spinner here; the tool message itself is the UI.
    args.bashModeInFlightRef.current = true

    const localTurnId = `local-bash-${args.nextCanonicalTurnSeq()}`

    try {
      const localTurnOutcome = await runLocalBashTurn({
        command,
        cwd: args.runtimeCwd,
        env: args.runtimeEnv,
        runtimeFlags: args.runtimeFlags,
        threadId: args.canonicalThreadId,
        turnId: localTurnId,
        nextReplaySeq: args.nextCanonicalReplaySeq,
        onCanonicalEvent: args.onCanonicalEvent,
        setMessages: args.setMessages,
        writeLegacyTranscriptRows: false,
        pendingInjectedBlocksRef: args.pendingInjectedBlocksRef,
        abortControllerRef: args.abortControllerRef,
        clearCanonicalTransientState: args.clearCanonicalTransientState,
      })
      args.appendLocalBashCanonicalTail({
        localTurnId,
        localTurnOutcome,
      })
    } finally {
      args.bashModeInFlightRef.current = false
    }

    return
  }

  recordClaudeMdInjectionEvent({
    sessionSaveEnabled: args.sessionSaveEnabled,
    cwd: args.runtimeCwd,
    env: args.runtimeEnv,
    includeAutoMemory: args.runtimeFlags.deferredToolExposureEnabled === true,
    lastSigRef: args.claudeMdMetaSigRef,
    writer: args.sessionWriterRef.current,
  })

  const { sendStateSetters, replModeAccess, sendTurnSharedRefs } = createSendTurnContext({
    setMessages: args.setMessages,
    setIsLoading: args.setIsLoading,
    setLoadingText: args.setLoadingText,
    setThinkingText: args.setThinkingText,
    setError: args.setError,
    setContext: args.setContext,
    getReplMode: () => args.modeCurrentRef.current,
    setReplMode: args.setReplMode,
    historyRef: args.historyRef,
    pendingInjectedBlocksRef: args.pendingInjectedBlocksRef,
    contextBudgetConfigRef: args.contextBudgetConfigRef,
    abortControllerRef: args.abortControllerRef,
    assistantBufferRef: args.assistantBufferRef,
    thinkingBufferRef: args.thinkingBufferRef,
    thinkingLastFlushAtRef: args.thinkingLastFlushAtRef,
    currentAssistantIdRef: args.currentAssistantIdRef,
  })
  await runReplModelSendFlow({
    input: {
      text,
      preferredSlashSpecId: args.opts?.preferredSlashSpecId,
      provider,
      providerError,
    },
    deps: {
      engine: args.engine,
      cfg: args.cfg,
      mode: args.mode,
      planSession: args.planSession,
      commandRegistry: args.commandRegistry,
      tools: args.tools,
      runtimeFlags: args.runtimeFlags,
      allowedSubagents: args.allowedSubagents,
    },
    sendContext: {
      sendStateSetters,
      replModeAccess,
      sendTurnSharedRefs,
    },
    turnRefs: {
      pendingExitPlanReminderRef: args.pendingExitPlanReminderRef,
      deferredToolExposureSessionKeyRef: args.deferredToolExposureSessionKeyRef,
      sendSeqRef: args.sendSeqRef,
      autoCompactSeqRef: args.autoCompactSeqRef,
      reminderServiceRef: args.reminderServiceRef,
    },
    canonical: {
      turnIdRef: args.canonicalTurnIdRef,
      setCanonicalTransientActive: args.setCanonicalTransientActive,
      nextCanonicalTurnSeq: args.nextCanonicalTurnSeq,
      clearCanonicalTransientState: args.clearCanonicalTransientState,
    },
    callbacks: {
      openOverlay: args.openOverlay,
      closeOverlay: args.closeOverlay,
      newSession: args.runNewSession,
      handleEvent: args.handleEvent,
      onCompactLifecycle: args.onCompactLifecycle,
      onCompactRequested: args.onCompactRequested,
      onSlashLocalAsyncRecordForNextTurn: args.onSlashLocalAsyncRecordForNextTurn,
      onSlashLocalRecordForNextTurn: args.onSlashLocalRecordForNextTurn,
      emitCanonicalUiMessageForTurn: ({ turnId, message }) =>
        emitCanonicalUiMessageForTurn({
          threadId: args.canonicalThreadId,
          turnId,
          message,
          nextReplaySeq: args.nextCanonicalReplaySeq,
          onCanonicalEvent: args.onCanonicalEvent,
        }),
      finalizeCanonicalTurn: ({ userMessageId, turnId, turnOutcome }) => {
        if (turnOutcome === 'aborted') {
          emitCanonicalTurnFooterForTurn({
            threadId: args.canonicalThreadId,
            turnId,
            status: 'interrupted',
            message: 'Request aborted',
            nextReplaySeq: args.nextCanonicalReplaySeq,
            onCanonicalEvent: args.onCanonicalEvent,
          })
        } else if (turnOutcome === 'failed') {
          emitCanonicalTurnFooterForTurn({
            threadId: args.canonicalThreadId,
            turnId,
            status: 'failed',
            nextReplaySeq: args.nextCanonicalReplaySeq,
            onCanonicalEvent: args.onCanonicalEvent,
          })
        }

        void userMessageId
        args.clearCanonicalTransientState()
      },
    },
  })
}

export function persistCanonicalToolEvent(args: {
  sessionSaveEnabled: boolean
  event: CanonicalEvent
  writer: SessionWriter | null
}): void {
  if (!args.sessionSaveEnabled) return
  if (args.event.kind !== 'tool_event') return
  void args.writer?.appendEvent('app_tool_event', toPersistedAppToolEventData(args.event))
}
