import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../config/config'
import type { TokenUsage } from '../../streaming/types'
import type { Msg } from '../../shared/toolMessageTypes'
import type { PromptBlock } from '../../prompts'
import type { ReplMode } from './mode'
import type { SlashCommandRegistry } from '../commands/registry'
import type { LocalCommandRecord } from '../commands/registry'
import type { PlanSessionManager } from './planSession'
import type { SystemPromptProfile } from '../../prompts/system'
import { ReminderService } from './reminders/ReminderService'
import type { ContextBudgetConfig } from '../../chat/context/budget'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import type {
  AgentsDialogGenerateDraft,
  AgentsDialogSaveArgs,
  AgentsDialogSaveResult,
} from '../../tui/agents/AgentsDialog.js'
import type { ConfigDialogExit } from '../../tui/config/ConfigDialog.js'
import type { ModelDialogExit } from '../../tui/model/ModelDialog.js'
import type { ResumeDialogExit } from '../../tui/resume/ResumeDialog.js'
import {
  partitionMessages,
  queueTranscriptSurfaceReplace,
  queueTranscriptSurfaceReset,
  useReplOverlays,
} from './controller/ui/ui'
import { useReplStreaming, type ExploreTaskBatch } from './controller/streaming/streaming'
import {
  assertReplCanonicalInvariants,
  appendCanonicalTailFinalRows,
  emitCanonicalUiMessageForTurn,
  emitCanonicalTurnFooterForTurn,
  projectCanonicalEventToTransientMessages,
} from './controller/canonical/canonical'
import { resolveTurnProvider } from './controller/shared/shared'
import {
  applyConfigExitInjection,
  buildMessageByIdMap,
  buildPersistedMsgRefMap,
  buildPersistedSigMap,
  ensureSessionWriter as ensureSessionWriterInternal,
  markDirtyMessageIdsFromTransition,
  openInitialSessionWriter as openInitialSessionWriterInternal,
  persistDirtyStableMessages,
  recordClaudeMdInjectionEvent,
  recordCompactRequestedEvent,
  recordLocalCommandInjectionEvent,
  shutdownSessionWriter as shutdownSessionWriterInternal,
  startNewSessionWriter as startNewSessionWriterInternal,
  registerSessionWriterProcessHandlers,
  runSessionTurnCompletionSideEffects,
  runAbortSessionTransition,
  runNewSessionTransition,
  runResumeSessionTransition,
  type SessionWriterRefs,
} from './controller/session/session'
import { createSendTurnContext } from './controller/send/sendTypes'
import { runLocalBashTurn } from './controller/send/bashMode'
import { runReplModelSendFlow } from './controller/send/sendOrchestration'
import { maybeHandleClearCommand } from './controller/send/send'
import type { CompactLifecycleEvent } from './controller/send/compactFlow'
import {
  createInitialTranscriptProjectionState,
} from '../semantics/projection/projection'
import type { CanonicalEvent } from '../semantics/core/core'
import {
  resolveReplModeTransition,
  shouldInjectExitPlanReminder,
} from '../semantics/core/core'
import { SessionWriter } from './sessionSave/writer'
import { readSessionFile } from './sessionSave/reader'
import { toPersistedAppToolEventData } from './sessionSave/appToolEventPayload'
import { createRuntimeFlags, type RuntimeFlags } from '../../config/runtimeFlags'

const CANONICAL_THREAD_ID = 'tui-live'

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '"[unserializable]"'
  }
}

function areToolInfosEqual(a: Msg['toolInfo'] | undefined, b: Msg['toolInfo'] | undefined): boolean {
  if (!a || !b) return false
  if (a.name !== b.name) return false
  if (a.toolUseId !== b.toolUseId) return false
  if (a.status !== b.status) return false
  if (a.result !== b.result) return false

  if (safeJson(a.input) !== safeJson(b.input)) return false
  if (safeJson(a.middleLines) !== safeJson(b.middleLines)) return false
  if (safeJson(a.transcriptLines) !== safeJson(b.transcriptLines)) return false
  if (safeJson(a.nestedTools) !== safeJson(b.nestedTools)) return false
  if (a.toolUses !== b.toolUses) return false
  if (safeJson(a.usage) !== safeJson(b.usage)) return false
  if (a.durationMs !== b.durationMs) return false
  if (a.patchStartLineNumber !== b.patchStartLineNumber) return false
  if (safeJson(a.expandInfo) !== safeJson(b.expandInfo)) return false
  return true
}

function shouldKeepExistingStaticRow(existing: Msg | undefined, incoming: Msg): boolean {
  if (!existing) return false
  if (existing.surfaceOwner !== 'static' || incoming.surfaceOwner !== 'static') return false
  if (existing.id !== incoming.id) return false

  if (existing.role === incoming.role) {
    const existingUiKind = existing.ui?.kind ?? null
    const incomingUiKind = incoming.ui?.kind ?? null
    if (existing.role === 'tool') {
      return (
        existingUiKind === incomingUiKind &&
        existing.content === incoming.content &&
        !existing.isStreaming &&
        areToolInfosEqual(existing.toolInfo, incoming.toolInfo)
      )
    }

    if (existingUiKind === incomingUiKind && existing.content === incoming.content && !existing.isStreaming) {
      return true
    }
  }

  return false
}

function mergeProjectedStaticRows(args: {
  prev: Msg[]
  projectedStaticRows: Msg[]
  onNonAppendUpdate?: () => void
}): Msg[] {
  if (args.projectedStaticRows.length === 0) return args.prev
  const indexById = new Map<string, number>()
  for (let index = 0; index < args.prev.length; index += 1) {
    const message = args.prev[index]
    if (!message) continue
    indexById.set(message.id, index)
  }

  let next: Msg[] | null = null
  let didChange = false
  let timestampCursor: number | null = null

  const ensureNext = (): Msg[] => {
    if (next) return next
    next = [...args.prev]
    return next
  }

  const ensureTimestampCursor = (): number => {
    if (timestampCursor !== null) return timestampCursor
    const source = next ?? args.prev
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const message = source[index]
      if (!message) continue
      const ts = message.timestamp
      if (ts instanceof Date) {
        timestampCursor = ts.getTime()
        return timestampCursor
      }
    }
    timestampCursor = Date.now()
    return timestampCursor
  }

  for (const projectedRow of args.projectedStaticRows) {
    const existingIndex = indexById.get(projectedRow.id)
    if (existingIndex === undefined) {
      const list = ensureNext()
      indexById.set(projectedRow.id, list.length)
      let incoming: Msg = {
        ...projectedRow,
        surfaceOwner: 'static',
        isStreaming: false,
      }
      const cursor = ensureTimestampCursor()
      const raw = incoming.timestamp instanceof Date ? incoming.timestamp.getTime() : Number.NaN
      if (Number.isFinite(raw) && raw > cursor) {
        timestampCursor = raw
      } else {
        timestampCursor = cursor + 1
        incoming = { ...incoming, timestamp: new Date(timestampCursor) }
      }
      list.push(incoming)
      didChange = true
      continue
    }

    const source = next ?? args.prev
    const existing = source[existingIndex]
    if (shouldKeepExistingStaticRow(existing, projectedRow)) continue

    const list = ensureNext()
    list[existingIndex] = {
      ...projectedRow,
      surfaceOwner: 'static',
      isStreaming: false,
      timestamp: existing?.timestamp ?? projectedRow.timestamp,
    }
    args.onNonAppendUpdate?.()
    didChange = true
  }

  return didChange ? (next ?? args.prev) : args.prev
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
    transientSnapshotRef: useRef<{ turnId: string; includeAssistantStreaming: boolean; messages: Msg[] } | null>(null),
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
	    pendingStaticSurfaceResetRef: useRef(false),
  }
  // Local bash mode (`! <cmd>`) runs outside the LLM turn and must not overlap with other sends.
  const bashModeInFlightRef = useRef(false)
  const sessionTransitionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const sessionTransitionPendingCountRef = useRef(0)
  const sessionWriterRef = useRef<SessionWriter | null>(null)
  const sessionWriterInitPromiseRef = useRef<Promise<void> | null>(null)
  const initialSessionFilePathRef = useRef<string | undefined>(deps.initialSession?.filePath)
  const lastPersistedSigByMsgIdRef = useRef<Map<string, string>>(new Map())
  const lastPersistedMsgByIdRef = useRef<Map<string, Msg>>(new Map())
  const previousMessagesRef = useRef<Msg[]>(messages)
  const messageByIdRef = useRef<Map<string, Msg>>(buildMessageByIdMap(messages))
  const dirtyMessageIdsRef = useRef<Set<string>>(new Set(messages.map((message) => message.id)))
  const sessionWriterRefs: SessionWriterRefs = {
    sessionWriterRef,
    sessionWriterInitPromiseRef,
    lastPersistedSigByMsgIdRef,
    lastPersistedMsgByIdRef,
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
    const initialSessionFilePath = initialSessionFilePathRef.current
    await openInitialSessionWriterInternal({
      sessionSaveEnabled,
      initialSession: {
        ...(initialSessionFilePath ? { filePath: initialSessionFilePath } : {}),
        ...(deps.initialSession?.messages ? { messages: deps.initialSession.messages } : {}),
      },
      historyRef,
      refs: sessionWriterRefs,
      startNewWriter: startNewSessionWriter,
    })
  }, [deps.initialSession?.messages, sessionSaveEnabled, startNewSessionWriter])

  const shutdownSessionWriter = useCallback(async (): Promise<void> => {
    await shutdownSessionWriterInternal(sessionWriterRefs)
  }, [])

  useEffect(() => {
    return () => {
      if (!sessionSaveEnabled) return
      void shutdownSessionWriter()
    }
  }, [sessionSaveEnabled, shutdownSessionWriter])

  useEffect(() => {
    initialSessionFilePathRef.current = deps.initialSession?.filePath
  }, [deps.initialSession?.filePath])

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
    canonicalRefs.transientSnapshotRef.current = null
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
    if (sessionSaveEnabled && event.kind === 'tool_event') {
      const writer = sessionWriterRef.current
      if (writer) {
        void writer.appendEvent('app_tool_event', toPersistedAppToolEventData(event))
      }
    }

	    const includeAssistantStreaming = assistantTextMode === 'stream'
	    const projected = projectCanonicalEventToTransientMessages({
	      projection: canonicalRefs.projectionRef.current,
	      event,
	      activeTurnId: canonicalRefs.turnIdRef.current,
	      includeAssistantStreaming,
	      previousTransient: canonicalRefs.transientSnapshotRef.current,
	    })
	    canonicalRefs.projectionRef.current = projected.projection
	    const projectedStaticRows: Msg[] = []
	    const projectedTransientRows: Msg[] = []
	    for (const message of projected.messages) {
	      if (message.surfaceOwner === 'static') projectedStaticRows.push(message)
	      else projectedTransientRows.push(message)
	    }

	    if (projectedStaticRows.length > 0 || event.kind === 'turn_footer') {
	      setMessages((prev) => {
	        const next = mergeProjectedStaticRows({
	          prev,
	          projectedStaticRows,
	          onNonAppendUpdate: () => {
	            runtimeStateRefs.pendingStaticSurfaceResetRef.current = true
	          },
	        })
	        if (event.kind === 'turn_footer') {
	          assertReplCanonicalInvariants({
	            projection: projected.projection,
	            messages: next,
	            targetTurnId: projected.turnId,
	          })
	        }
	        return next
	      })
	    }

    setCanonicalTransientActive(projectedTransientRows.length > 0)
    canonicalRefs.transientSnapshotRef.current = {
      turnId: projected.turnId,
      includeAssistantStreaming,
      messages: projectedTransientRows,
    }
    if (projected.changed) {
      setCanonicalTurnMessages(projectedTransientRows)
    }
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

  useEffect(() => {
    if (!sessionSaveEnabled) return
    if (!deps.initialSession?.filePath) return
    void ensureSessionWriter()
  }, [deps.initialSession?.filePath, ensureSessionWriter, sessionSaveEnabled])

  useEffect(() => {
    if (!sessionSaveEnabled) {
      previousMessagesRef.current = messages
      messageByIdRef.current = buildMessageByIdMap(messages)
      dirtyMessageIdsRef.current.clear()
      return
    }
    markDirtyMessageIdsFromTransition({
      previous: previousMessagesRef.current,
      next: messages,
      messageByIdRef,
      dirtyMessageIdsRef,
    })
    previousMessagesRef.current = messages
  }, [messages, sessionSaveEnabled])

  useEffect(() => {
    if (!sessionSaveEnabled) {
      dirtyMessageIdsRef.current.clear()
      return
    }
    persistDirtyStableMessages({
      writer: sessionWriterRef.current,
      dirtyMessageIdsRef,
      messageByIdRef,
      lastPersistedSigByMsgIdRef,
      lastPersistedMsgByIdRef,
    })
  }, [messages, sessionSaveEnabled])

  useEffect(() => {
    const writer = sessionWriterRef.current
    const wasLoading = runtimeStateRefs.previousIsLoadingRef.current
    runtimeStateRefs.previousIsLoadingRef.current = isLoading
    runSessionTurnCompletionSideEffects({
      writer,
      wasLoading,
      isLoading,
      history: historyRef.current,
      messages,
      engine: deps.engine,
      cwd: runtimeCwd,
      attemptedSessionIds: autoTitleRefs.attemptedSessionIdsRef.current,
      checkedTopicPromptKeys: autoTitleRefs.checkedTopicPromptKeysRef.current,
      model: deps.cfg.llm.model,
    })
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
    const canonicalTurnId = canonicalRefs.turnIdRef.current
    if (canonicalTurnId) {
      const trackedRunningToolsSnapshot = Array.from(toolRuntimeRefs.nameByIdRef.current.entries())
      const hadInFlightRequest = Boolean(abortControllerRef.current) || isLoading

      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      bashModeInFlightRef.current = false

      userInput?.clearBufferedAnswers()
      userInput?.rejectAllPending(new Error('Request aborted'))

      resetSessionUiState()
      setIsLoading(false)
      clearToolRuntimeState()

      emitCanonicalTurnFooterForTurn({
        threadId: CANONICAL_THREAD_ID,
        turnId: canonicalTurnId,
        status: 'interrupted',
        message: 'Request aborted',
        nextReplaySeq: nextCanonicalReplaySeq,
        onCanonicalEvent,
      })

      const hadAsk =
        trackedRunningToolsSnapshot.some(([, name]) => name === 'AskUserQuestion') ||
        canonicalRefs.transientSnapshotRef.current?.messages.some(
          (m) => m.role === 'tool' && m.toolInfo?.name === 'AskUserQuestion' && m.toolInfo?.status === 'running',
        ) === true

      if (hadAsk && hadInFlightRequest) {
        emitCanonicalUiMessageForTurn({
          threadId: CANONICAL_THREAD_ID,
          turnId: canonicalTurnId,
          message: { role: 'assistant', content: 'User declined to answer questions' },
          nextReplaySeq: nextCanonicalReplaySeq,
          onCanonicalEvent,
        })
      }

      clearCanonicalTransientState()
      return
    }

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

  const queueSessionTransition = useCallback((run: () => Promise<void>): Promise<void> => {
    sessionTransitionPendingCountRef.current += 1
    const next = sessionTransitionQueueRef.current.catch(() => undefined).then(async () => {
      try {
        await run()
      } finally {
        sessionTransitionPendingCountRef.current = Math.max(0, sessionTransitionPendingCountRef.current - 1)
      }
    })
    sessionTransitionQueueRef.current = next.catch(() => undefined)
    return next
  }, [])

  const runNewSession = useCallback(async (): Promise<void> => {
    initialSessionFilePathRef.current = undefined
    await queueSessionTransition(async () => {
      await runNewSessionTransition({
        beginNewSession: () => deps.engine.beginNewSession?.({ source: 'clear' }),
        sessionSaveEnabled,
        sessionWriterRef,
        sessionWriterInitPromiseRef,
        lastPersistedSigByMsgIdRef,
        lastPersistedMsgByIdRef,
        resetSessionState,
        replaceTranscript,
      })
    })
  }, [deps.engine, queueSessionTransition, replaceTranscript, resetSessionState, sessionSaveEnabled])

  const newSession = useCallback(() => {
    void runNewSession()
  }, [runNewSession])

  const renameSession = useCallback(async (filePath: string, label: string): Promise<void> => {
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendEvent('session_rename', { label })
    await writer.shutdown()
  }, [])

  const resumeSession = useCallback(
    async (filePath: string): Promise<void> => {
      if (isLoading) return

      closeResumeDialog()
      initialSessionFilePathRef.current = filePath
      try {
        await queueSessionTransition(async () => {
          abort()
          await runResumeSessionTransition({
            filePath,
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
          })
        })
      } catch (resumeError) {
        const message = resumeError instanceof Error ? resumeError.message : String(resumeError)
        setError(`Failed to resume session: ${message}`)
      }
    },
    [
      abort,
      closeResumeDialog,
      deps.engine,
      isLoading,
      queueSessionTransition,
      replaceTranscript,
      resetSessionState,
      sessionSaveEnabled,
    ],
  )

  const send = useCallback(
    async (value: string, opts?: { preferredSlashSpecId?: string }) => {
      const text = value.trim()
      if (!text || isLoading || bashModeInFlightRef.current || sessionTransitionPendingCountRef.current > 0) return

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

      const didHandleClear = await maybeHandleClearCommand({
        text,
        isLoading,
        setMessages,
        newSession: runNewSession,
      })
      if (didHandleClear) return

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
          const localTurnOutcome = await runLocalBashTurn({
            command,
            cwd: runtimeCwd,
            env: runtimeEnv,
            runtimeFlags,
            threadId: CANONICAL_THREAD_ID,
            turnId: localTurnId,
            nextReplaySeq: nextCanonicalReplaySeq,
            onCanonicalEvent,
            setMessages,
            writeLegacyTranscriptRows: false,
            pendingInjectedBlocksRef: turnFlowRefs.pendingInjectedBlocksRef,
            abortControllerRef,
            clearCanonicalTransientState,
          })
          setMessages((prev) => {
            const nextMessages = appendCanonicalTailFinalRows({
              messages: prev,
              turnId: localTurnId,
              turnOutcome: localTurnOutcome === 'aborted' ? 'failed' : localTurnOutcome,
              projectionSegments: canonicalRefs.projectionRef.current.segments,
            })
            assertReplCanonicalInvariants({
              projection: canonicalRefs.projectionRef.current,
              messages: nextMessages,
              targetTurnId: localTurnId,
            })
            return nextMessages
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
      await runReplModelSendFlow({
        input: {
          text,
          preferredSlashSpecId: opts?.preferredSlashSpecId,
          provider,
          providerError,
        },
        deps: {
          engine: deps.engine,
          cfg: deps.cfg,
          promptProfile: deps.promptProfile,
          mode: deps.mode,
          planSession: deps.planSession,
          commandRegistry: deps.commandRegistry,
          tools: deps.tools,
          allowedSubagents,
        },
        sendContext: {
          sendStateSetters,
          replModeAccess,
          sendTurnSharedRefs,
        },
        turnRefs: {
          pendingExitPlanReminderRef: turnFlowRefs.pendingExitPlanReminderRef,
          sendSeqRef: runtimeStateRefs.sendSeqRef,
          autoCompactSeqRef: runtimeStateRefs.autoCompactSeqRef,
          reminderServiceRef: turnFlowRefs.reminderServiceRef,
        },
        canonical: {
          turnIdRef: canonicalRefs.turnIdRef,
          setCanonicalTransientActive,
          nextCanonicalTurnSeq,
          clearCanonicalTransientState,
        },
        callbacks: {
          openOverlay,
          closeOverlay,
          newSession: runNewSession,
          handleEvent,
          onCompactLifecycle,
          onCompactRequested,
          onSlashLocalAsyncRecordForNextTurn,
          onSlashLocalRecordForNextTurn,
          emitCanonicalUiMessageForTurn: ({ turnId, message }) =>
            emitCanonicalUiMessageForTurn({
              threadId: CANONICAL_THREAD_ID,
              turnId,
              message,
              nextReplaySeq: nextCanonicalReplaySeq,
              onCanonicalEvent,
            }),
	          finalizeCanonicalTurn: ({ userMessageId, turnId, turnOutcome }) => {
            if (turnOutcome === 'aborted') {
              emitCanonicalTurnFooterForTurn({
                threadId: CANONICAL_THREAD_ID,
                turnId,
                status: 'interrupted',
                message: 'Request aborted',
                nextReplaySeq: nextCanonicalReplaySeq,
                onCanonicalEvent,
              })
            } else if (turnOutcome === 'failed') {
              emitCanonicalTurnFooterForTurn({
                threadId: CANONICAL_THREAD_ID,
                turnId,
                status: 'failed',
                nextReplaySeq: nextCanonicalReplaySeq,
                onCanonicalEvent,
              })
            }

	            void userMessageId
	            clearCanonicalTransientState()
	          },
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
 
