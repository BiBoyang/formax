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
import type { RequestCollapseCommitState } from './send/contextCompressionService'
import type { ContextCollapseMeta } from '../../../chat/context/contextCollapse'
import type { ContextCollapseStoreSnapshot } from '../../../chat/context/contextCollapseStore'
import type { ReactiveCompactErrorKind } from './send/reactiveCompact'
import type { CanonicalEvent } from '../../semantics/core'
import type { TranscriptProjectionState } from '../../semantics/projection'
import type { OverlaySpec } from '../../commands/contracts'
import type { ReminderService } from '../reminders/ReminderService'
import type { ContextBudgetConfig } from '../../../chat/context/budget'
import { resolveTurnProvider } from './shared'
import { maybeHandleClearCommand } from './send/send'
import { runLocalBashTurn } from './send/bashMode'
import { runReplModelSendFlow } from './send/sendOrchestration'
import { createSendTurnContext } from './send/sendTypes'
import {
  appendCanonicalTailFinalRows,
  assertReplCanonicalInvariants,
  emitCanonicalTurnFooterForTurn,
  emitCanonicalUiMessageForTurn,
} from './canonical'
import {
  hasRunningAskTool,
  mapLocalBashTurnOutcomeForTail,
  shouldBlockSendWhileBusy,
} from './send/turnGuards'
import { recordClaudeMdInjectionEvent } from './session'
import { toPersistedAppToolEventData } from '../sessionSave/appToolEventPayload'
import { runAbortSessionTransition } from './session'
import { SessionWriter } from '../sessionSave/writer'

type CanonicalTransientSnapshot = { turnId: string; includeAssistantStreaming: boolean; messages: Msg[] } | null
type ReplContext = {
  usedTokens: number
  limitTokens: number
  percentRemaining: number
  source: 'estimate' | 'usage'
}

export type AbortFlowRefs = {
  canonicalTurnIdRef: { current: string | null }
  canonicalTransientSnapshotRef: { current: CanonicalTransientSnapshot }
  toolNameByIdRef: { current: Map<string, string> }
  abortControllerRef: { current: AbortController | null }
  bashModeInFlightRef: { current: boolean }
  currentAssistantIdRef: { current: string | null }
}

export type AbortFlowCallbacks = {
  resetSessionUiState: () => void
  clearCanonicalTransientState: () => void
  clearToolRuntimeState: () => void
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  nextCanonicalReplaySeq: () => number
  onCanonicalEvent: (event: CanonicalEvent) => void
}

type AbortFlowRuntime = {
  canonicalThreadId: string
  isLoading: boolean
  userInput: UserInputManager | null | undefined
}

export function runAbortAction(args: {
  refs: AbortFlowRefs
  callbacks: AbortFlowCallbacks
  runtime: AbortFlowRuntime
}): void {
  const canonicalTurnId = args.refs.canonicalTurnIdRef.current
  if (canonicalTurnId) {
    const trackedRunningToolsSnapshot = Array.from(args.refs.toolNameByIdRef.current.entries())
    const hadInFlightRequest = Boolean(args.refs.abortControllerRef.current) || args.runtime.isLoading

    args.refs.abortControllerRef.current?.abort()
    args.refs.abortControllerRef.current = null
    args.refs.bashModeInFlightRef.current = false

    args.runtime.userInput?.clearBufferedAnswers()
    args.runtime.userInput?.rejectAllPending(new Error('Request aborted'))

    args.callbacks.resetSessionUiState()
    args.callbacks.setIsLoading(false)
    args.callbacks.clearToolRuntimeState()

    emitCanonicalTurnFooterForTurn({
      threadId: args.runtime.canonicalThreadId,
      turnId: canonicalTurnId,
      status: 'interrupted',
      message: 'Request aborted',
      nextReplaySeq: args.callbacks.nextCanonicalReplaySeq,
      onCanonicalEvent: args.callbacks.onCanonicalEvent,
    })

    const hadAsk = hasRunningAskTool({
      trackedRunningToolsSnapshot,
      transientSnapshot: args.refs.canonicalTransientSnapshotRef.current,
    })

    if (hadAsk && hadInFlightRequest) {
      emitCanonicalUiMessageForTurn({
        threadId: args.runtime.canonicalThreadId,
        turnId: canonicalTurnId,
        message: { role: 'assistant', content: 'User declined to answer questions' },
        nextReplaySeq: args.callbacks.nextCanonicalReplaySeq,
        onCanonicalEvent: args.callbacks.onCanonicalEvent,
      })
    }

    args.callbacks.clearCanonicalTransientState()
    return
  }

  runAbortSessionTransition({
    isLoading: args.runtime.isLoading,
    abortControllerRef: args.refs.abortControllerRef,
    bashModeInFlightRef: args.refs.bashModeInFlightRef,
    toolNameByIdRef: args.refs.toolNameByIdRef,
    userInput: args.runtime.userInput,
    resetSessionUiState: args.callbacks.resetSessionUiState,
    clearCanonicalTransientState: args.callbacks.clearCanonicalTransientState,
    clearToolRuntimeState: args.callbacks.clearToolRuntimeState,
    currentAssistantIdRef: args.refs.currentAssistantIdRef,
    setMessages: args.callbacks.setMessages,
    setIsLoading: args.callbacks.setIsLoading,
  })
}

export type SendFlowDeps = {
  cfg: RuntimeConfig
  mode: ReplMode
  engine: ChatEngine
  planSession?: PlanSessionManager
  commandRegistry?: SlashCommandRegistry
  tools: ToolDefinition[]
}

export type SendFlowRefs = {
  bashModeInFlightRef: { current: boolean }
  sessionTransitionPendingCountRef: { current: number }
  sessionWriterRef: { current: SessionWriter | null }
  canonicalProjectionRef: { current: TranscriptProjectionState }
  modeCurrentRef: { current: ReplMode }
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
  getSessionFilePath?: () => string | null
  getContextCollapseStoreSnapshot?: () => ContextCollapseStoreSnapshot | null | Promise<ContextCollapseStoreSnapshot | null>
  canonicalTurnIdRef: { current: string | null }
  claudeMdMetaSigRef: { current: string | null }
}

export type SendFlowCallbacks = {
  ensureSessionWriter: () => Promise<void>
  runNewSession: () => Promise<void>
  resetStreamingBuffers: () => void
  clearCanonicalTransientState: () => void
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  setLoadingText: Dispatch<SetStateAction<string>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
  setContext: Dispatch<SetStateAction<ReplContext | null>>
  setReplMode: (nextMode: ReplMode) => void
  setCanonicalTransientActive: Dispatch<SetStateAction<boolean>>
  nextCanonicalTurnSeq: () => number
  nextCanonicalReplaySeq: () => number
  onCanonicalEvent: (event: CanonicalEvent) => void
  onCompactLifecycle: (event: CompactLifecycleEvent) => void
  onRequestCollapse?: (event: {
    phase: 'initial' | 'reactive_retry'
    collapsedHeadMessageCount: number
    estimatedTokensSaved: number
    metadata: ContextCollapseMeta | null
    commit: RequestCollapseCommitState | null
  }) => void | Promise<void>
  onReactiveCompact?: (event: {
    triggerKind: ReactiveCompactErrorKind
    triggerDetail: string
    strategy: 'session_memory' | 'model_summary'
  }) => void
  onCompactRequested: () => void
  onSlashLocalAsyncRecordForNextTurn: (record: LocalCommandRecord) => void
  onSlashLocalRecordForNextTurn: (record: LocalCommandRecord) => void
  openOverlay: (spec: OverlaySpec) => void
  closeOverlay: () => void
  handleEvent: (ev: StreamEvent) => void
}

type SendFlowRuntime = {
  canonicalThreadId: string
  isLoading: boolean
  runtimeFlags: RuntimeFlags
  runtimeCwd: string
  runtimeEnv: NodeJS.ProcessEnv
  allowedSubagents: Array<{ name: string; description: string }>
  sessionSaveEnabled: boolean
}

function appendEmptyBashUsageMessage(setMessages: Dispatch<SetStateAction<Msg[]>>): void {
  setMessages((prev) => [
    ...prev,
    {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: 'Usage: ! <command>',
      timestamp: new Date(),
    },
  ])
}

function appendLocalBashCanonicalTail(args: {
  setMessages: Dispatch<SetStateAction<Msg[]>>
  projectionRef: { current: TranscriptProjectionState }
  localTurnId: string
  localTurnOutcome: 'completed' | 'failed' | 'aborted'
}): void {
  args.setMessages((prev) => {
    const nextMessages = appendCanonicalTailFinalRows({
      messages: prev,
      turnId: args.localTurnId,
      turnOutcome: mapLocalBashTurnOutcomeForTail(args.localTurnOutcome),
      projectionSegments: args.projectionRef.current.segments,
    })
    assertReplCanonicalInvariants({
      projection: args.projectionRef.current,
      messages: nextMessages,
      targetTurnId: args.localTurnId,
    })
    return nextMessages
  })
}

export async function runSendAction(args: {
  input: { value: string; opts?: { preferredSlashSpecId?: string } }
  deps: SendFlowDeps
  refs: SendFlowRefs
  callbacks: SendFlowCallbacks
  runtime: SendFlowRuntime
}): Promise<void> {
  const text = args.input.value.trim()
  if (
    shouldBlockSendWhileBusy({
      text,
      isLoading: args.runtime.isLoading,
      bashModeInFlight: args.refs.bashModeInFlightRef.current,
      sessionTransitionPendingCount: args.refs.sessionTransitionPendingCountRef.current,
    })
  ) {
    return
  }

  let provider: 'openai' | 'anthropic' = 'anthropic'
  let providerError: string | null = null
  try {
    provider = resolveTurnProvider(args.deps.cfg.llm.provider)
  } catch (error) {
    providerError = error instanceof Error ? error.message : 'Unsupported provider'
  }

  // Thinking/streaming state is per-turn; clear buffers so stale thinking
  // from previous turns can't leak into the next status line/panel.
  args.callbacks.resetStreamingBuffers()

  const didHandleClear = await maybeHandleClearCommand({
    text,
    isLoading: args.runtime.isLoading,
    setMessages: args.callbacks.setMessages,
    newSession: args.callbacks.runNewSession,
  })
  if (didHandleClear) return

  await args.callbacks.ensureSessionWriter()

  // Bash mode (`!` prefix): run a local shell command without involving the LLM.
  // The command + output are injected into the *next* real turn.
  if (text.startsWith('!')) {
    const command = text.replace(/^!\s*/, '').trim()
    if (!command) {
      appendEmptyBashUsageMessage(args.callbacks.setMessages)
      return
    }

    // Treat bash-mode as an in-flight operation: prevent overlapping sends and allow Ctrl+C to abort.
    // We intentionally avoid the LLM "isLoading" spinner here; the tool message itself is the UI.
    args.refs.bashModeInFlightRef.current = true

    const localTurnId = `local-bash-${args.callbacks.nextCanonicalTurnSeq()}`

    try {
      const localTurnOutcome = await runLocalBashTurn({
        command,
        cwd: args.runtime.runtimeCwd,
        env: args.runtime.runtimeEnv,
        runtimeFlags: args.runtime.runtimeFlags,
        threadId: args.runtime.canonicalThreadId,
        turnId: localTurnId,
        nextReplaySeq: args.callbacks.nextCanonicalReplaySeq,
        onCanonicalEvent: args.callbacks.onCanonicalEvent,
        setMessages: args.callbacks.setMessages,
        writeLegacyTranscriptRows: false,
        pendingInjectedBlocksRef: args.refs.pendingInjectedBlocksRef,
        abortControllerRef: args.refs.abortControllerRef,
        clearCanonicalTransientState: args.callbacks.clearCanonicalTransientState,
      })
      appendLocalBashCanonicalTail({
        setMessages: args.callbacks.setMessages,
        projectionRef: args.refs.canonicalProjectionRef,
        localTurnId,
        localTurnOutcome,
      })
    } finally {
      args.refs.bashModeInFlightRef.current = false
    }

    return
  }

  recordClaudeMdInjectionEvent({
    sessionSaveEnabled: args.runtime.sessionSaveEnabled,
    cwd: args.runtime.runtimeCwd,
    env: args.runtime.runtimeEnv,
    includeAutoMemory: args.runtime.runtimeFlags.deferredToolExposureEnabled === true,
    lastSigRef: args.refs.claudeMdMetaSigRef,
    writer: args.refs.sessionWriterRef.current,
  })

  const { sendStateSetters, replModeAccess, sendTurnSharedRefs } = createSendTurnContext({
    setMessages: args.callbacks.setMessages,
    setIsLoading: args.callbacks.setIsLoading,
    setLoadingText: args.callbacks.setLoadingText,
    setThinkingText: args.callbacks.setThinkingText,
    setError: args.callbacks.setError,
    setContext: args.callbacks.setContext,
    getReplMode: () => args.refs.modeCurrentRef.current,
    setReplMode: args.callbacks.setReplMode,
    historyRef: args.refs.historyRef,
    pendingInjectedBlocksRef: args.refs.pendingInjectedBlocksRef,
    contextBudgetConfigRef: args.refs.contextBudgetConfigRef,
    abortControllerRef: args.refs.abortControllerRef,
    assistantBufferRef: args.refs.assistantBufferRef,
    thinkingBufferRef: args.refs.thinkingBufferRef,
    thinkingLastFlushAtRef: args.refs.thinkingLastFlushAtRef,
    currentAssistantIdRef: args.refs.currentAssistantIdRef,
  })
  await runReplModelSendFlow({
    input: {
      text,
      preferredSlashSpecId: args.input.opts?.preferredSlashSpecId,
      provider,
      providerError,
    },
    deps: {
      engine: args.deps.engine,
      cfg: args.deps.cfg,
      mode: args.deps.mode,
      planSession: args.deps.planSession,
      commandRegistry: args.deps.commandRegistry,
      tools: args.deps.tools,
      runtimeFlags: args.runtime.runtimeFlags,
      allowedSubagents: args.runtime.allowedSubagents,
    },
    sendContext: {
      sendStateSetters,
      replModeAccess,
      sendTurnSharedRefs,
    },
    turnRefs: {
      pendingExitPlanReminderRef: args.refs.pendingExitPlanReminderRef,
      deferredToolExposureSessionKeyRef: args.refs.deferredToolExposureSessionKeyRef,
      sendSeqRef: args.refs.sendSeqRef,
      autoCompactSeqRef: args.refs.autoCompactSeqRef,
      reminderServiceRef: args.refs.reminderServiceRef,
      getSessionFilePath: () => args.refs.sessionWriterRef.current?.filePath ?? null,
      getContextCollapseStoreSnapshot: args.refs.getContextCollapseStoreSnapshot,
    },
    canonical: {
      turnIdRef: args.refs.canonicalTurnIdRef,
      setCanonicalTransientActive: args.callbacks.setCanonicalTransientActive,
      nextCanonicalTurnSeq: args.callbacks.nextCanonicalTurnSeq,
      clearCanonicalTransientState: args.callbacks.clearCanonicalTransientState,
    },
    callbacks: {
      openOverlay: args.callbacks.openOverlay,
      closeOverlay: args.callbacks.closeOverlay,
      newSession: args.callbacks.runNewSession,
      handleEvent: args.callbacks.handleEvent,
      onCompactLifecycle: args.callbacks.onCompactLifecycle,
      onRequestCollapse: args.callbacks.onRequestCollapse,
      onReactiveCompact: args.callbacks.onReactiveCompact,
      onCompactRequested: args.callbacks.onCompactRequested,
      onSlashLocalAsyncRecordForNextTurn: args.callbacks.onSlashLocalAsyncRecordForNextTurn,
      onSlashLocalRecordForNextTurn: args.callbacks.onSlashLocalRecordForNextTurn,
      emitCanonicalUiMessageForTurn: ({ turnId, message }) =>
        emitCanonicalUiMessageForTurn({
          threadId: args.runtime.canonicalThreadId,
          turnId,
          message,
          nextReplaySeq: args.callbacks.nextCanonicalReplaySeq,
          onCanonicalEvent: args.callbacks.onCanonicalEvent,
        }),
      finalizeCanonicalTurn: ({ userMessageId, turnId, turnOutcome }) => {
        if (turnOutcome === 'aborted') {
          emitCanonicalTurnFooterForTurn({
            threadId: args.runtime.canonicalThreadId,
            turnId,
            status: 'interrupted',
            message: 'Request aborted',
            nextReplaySeq: args.callbacks.nextCanonicalReplaySeq,
            onCanonicalEvent: args.callbacks.onCanonicalEvent,
          })
        } else if (turnOutcome === 'failed') {
          emitCanonicalTurnFooterForTurn({
            threadId: args.runtime.canonicalThreadId,
            turnId,
            status: 'failed',
            nextReplaySeq: args.callbacks.nextCanonicalReplaySeq,
            onCanonicalEvent: args.callbacks.onCanonicalEvent,
          })
        }

        void userMessageId
        args.callbacks.clearCanonicalTransientState()
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
