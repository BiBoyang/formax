import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  findLatestCompactBoundaryIndex,
  fingerprintCompactBoundaryMessage,
  isCompactBoundaryMessage,
  readCompactBoundaryMeta,
  type CompactTriggerReason,
} from '../chat/context/compact.js'
import type { ChatEngine, ChatHistory } from '../chat/engine.js'
import type { ContextBudgetConfig } from '../chat/context/budget.js'
import {
  CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME,
  appendContextCollapseStoreEntry,
  buildContextCollapseCommitStateCandidate,
  createContextCollapseCommittedEntry,
  requestHistoryContainsExactMessage,
  setContextCollapseStoreActiveCompactBoundaryFingerprint,
  type ContextCollapseCommittedEntry,
  type ContextCollapseStoreSnapshot,
} from '../chat/context/contextCollapseStore.js'
import { prepareTurnRequestProjection } from '../chat/context/turnRequestProjection.js'
import { isAnthropicCacheEditingEnabled } from '../chat/context/cacheEditing.js'
import {
  buildContextProjection,
  mergeDurableSnipSnapshot,
  rebaseCollapseHeadCountAfterDurableSnip,
  scopeDurableSnipStateToHistory,
  scopeDurableToolResultContentReplacementStateToHistory,
} from '../chat/context/contextProjection.js'
import { stampMissingAssistantMessageTimestamps } from '../chat/context/promptMessageTimestamps.js'
import type { PromptBlock } from '../prompts/index.js'
import {
  buildSystemPrompt,
  resolveSystemPromptVariant,
} from '../prompts/index.js'
import { readContextCollapseStoreSnapshotFromSession } from '../features/repl/sessionRestore/contextCollapseStore.js'
import {
  findSessionFileBySessionId,
  DURABLE_SNIP_COMMITTED_EVENT_NAME,
  readDurableSnipStateFromSession,
  readDurableToolResultContentReplacementStateFromSession,
  readSessionFile,
  SessionWriter,
} from '../features/repl/sessionSave/index.js'
import { runCompactFlow } from '../features/repl/controller/send/compactFlow.js'
import {
  createContextCompressionService,
  type RequestCollapseState,
  type RequestSnipState,
} from '../features/repl/controller/send/contextCompressionService.js'
import {
  classifyReactiveCompactError,
  isReactiveCompactEligibleError,
} from '../features/repl/controller/send/reactiveCompact.js'
import { isAbortLikeError } from '../features/repl/controller/shared/utils.js'
import type { Msg } from '../shared/toolMessageTypes.js'
import { sourceFromInputKind } from '../shared/inputContracts.js'
import { sourceFromRuntimeEventType } from '../shared/runtimeEventSource.js'
import type { StreamEvent } from '../streaming/types.js'
import type { ToolDefinition } from '../tools/types.js'
import { resolveDeferredToolExposureForTurn } from '../tools/runtime/deferredToolExposureResolver.js'
import { applyToolFilters, resolveToolFilters } from '../tools/runtime/toolFilter.js'
import type { UserInputManager } from '../tools/runtime/userInputManager.js'
import type {
  InputEnvelopeMeta,
  InputRequestedPayload,
  InputResolvedPayload,
  TurnInputSubmitResult,
} from './protocol/input.js'
import type { TurnInputSubmitParams, TurnInterruptParams, TurnStartParams } from './protocol.js'
import { TurnInputStore } from './turn/inputStore.js'
import { maybeAutoGenerateSessionTitle } from '../features/sessionTitle/index.js'
import {
  buildTurnInput,
  normalizeReplMode,
  resolveCommandRouting,
  resolveReplModeTransition,
  type ReplMode,
} from '@formax/semantics'
import { computeEditPatchStartLineNumber } from '../features/repl/controller/streaming/patchStartLineNumber.js'
import { toolResultContentToText } from '../shared/utils/toolResultContent.js'
import { createRuntimeFlags, type RuntimeFlags } from '../config/runtimeFlags.js'
import { loadRuntimeConfig, type RuntimeConfig } from '../config/config.js'
import { resolveRuntimeModelProfile } from '../config/runtimeModelProfile.js'
import { createPlanSessionManager, type PlanSessionManager } from '../features/repl/planSession.js'
import {
  normalizeContextMeterBudgetRaw,
  type ContextMeterBudgetRaw,
} from '@formax/shared/utils/contextMeter'
import type { RuntimeModelProfile } from '../core/models/modelCapability.js'

type TurnStatus = 'running' | 'completed' | 'failed' | 'interrupted'

type TurnStartRuntimeParams = TurnStartParams & {
  includeExitPlanReminder?: boolean
  pendingInjectedBlocks?: PromptBlock[]
  onPendingInjectedBlocksConsumed?: (args: { threadId: string; turnId: string }) => void | Promise<void>
}

type ReactiveCompactPreparation = Awaited<
  ReturnType<ReturnType<typeof createContextCompressionService>['runReactiveCompact']>
>

export type TurnRunnerNotificationEmitter = (method: string, params?: unknown) => void

export type TurnRunnerOptions = {
  engine: Pick<ChatEngine, 'runTurn'>
  tools: ToolDefinition[]
  allowedSubagents: Array<{ name: string; description: string }>
  model: string
  thinkingEnabled?: boolean
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
  userInputManager?: UserInputManager | null
  emitNotification: TurnRunnerNotificationEmitter
  defaultInputTtlMs?: number
  maxPendingInputsPerThread?: number
  ensureThreadFilePath?: (args: { threadId: string; cwd: string }) => Promise<string>
  runtimeFlags?: RuntimeFlags
}

type RunningTurn = {
  turnId: string
  traceId: string
  seq: number
  threadId: string
  filePath: string
  cwd: string
  inputText: string
  modelInputText: string
  modelUserContent: PromptBlock[]
  semanticBlockCount: number
  pendingInjectedBlockCount: number
  onPendingInjectedBlocksConsumed: ((args: { threadId: string; turnId: string }) => void | Promise<void>) | null
  replMode: ReplMode
  planSession: PlanSessionManager | null
  planPath: string | null
  abortController: AbortController
  inputStore: TurnInputStore
  writer: SessionWriter | null
  pendingEventWrites: Array<Promise<void>>
  inputExpiryTimers: Map<string, ReturnType<typeof setTimeout>>
  compact: {
    isCommand: boolean
    instructions: string
  }
  runtimeConfig: RuntimeConfig
  runtimeProfile: RuntimeModelProfile
  toolNameByUseId: Map<string, string>
  toolInputByUseId: Map<string, unknown>
}

export const DEFAULT_INPUT_TTL_MS = 5 * 60_000
export const DEFAULT_MAX_PENDING_INPUTS_PER_THREAD = 32
const MANUAL_COMPACT_KEEP_LAST_TURNS = 0
const COMPACT_BANNER_TEXT = 'Conversation compacted. Summary kept for future turns.'

function sourceFromStreamEvent(event: StreamEvent): InputEnvelopeMeta['source'] {
  return sourceFromRuntimeEventType(event.type)
}

function compactParamsText(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return undefined
  const parts = entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  const text = parts.join(', ')
  return text.length > 220 ? `${text.slice(0, 220)}...` : text
}

function resolveEditPatchStartLineNumber(args: {
  cwd: string
  toolName: string | undefined
  isError: boolean
  toolInput: unknown
}): number | null {
  if (args.toolName !== 'Edit' || args.isError) return null
  return computeEditPatchStartLineNumber({
    cwd: args.cwd,
    input: args.toolInput ?? {},
  })
}

function flattenPromptText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const chunks: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if ((block as { type?: unknown }).type !== 'text') continue
    const text = (block as { text?: unknown }).text
    if (typeof text !== 'string') continue
    const trimmed = text.trim()
    if (!trimmed) continue
    chunks.push(trimmed)
  }
  return chunks.join('\n\n')
}

function firstUserPromptFromHistory(history: ChatHistory): string | null {
  for (const message of history) {
    if (!message || message.role !== 'user') continue
    const text = flattenPromptText(message.content)
    if (!text) continue
    return text
  }
  return null
}

function extractAssistantText(history: ChatHistory): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    if (message?.role !== 'assistant') continue
    if (!Array.isArray(message.content)) continue
    const text = message.content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        if ((block as { type?: unknown }).type !== 'text') return ''
        const value = (block as { text?: unknown }).text
        return typeof value === 'string' ? value : ''
      })
      .join('')
      .trim()
    if (text) return text
  }
  return ''
}

function toToolUpdateLine(event: Extract<StreamEvent, { type: 'tool_update' }>): string | null {
  const transcriptLines = Array.isArray(event.transcriptLines) ? event.transcriptLines : []
  const middleLines = Array.isArray(event.middleLines) ? event.middleLines : []
  const line = transcriptLines[transcriptLines.length - 1] ?? middleLines[middleLines.length - 1]
  if (typeof line === 'string' && line.trim()) return line.trim()
  if (typeof event.toolUses === 'number') return `tool uses ${event.toolUses}`
  return null
}

function toToolEndPayload(event: Extract<StreamEvent, { type: 'tool_end' }>): {
  status: 'completed' | 'error'
  summary: string
  lines: string[]
} {
  const status: 'completed' | 'error' = event.result?.is_error ? 'error' : 'completed'
  const raw = toolResultContentToText(event.result?.content ?? '')
  const lines = raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => Boolean(line.trim()))
    .slice(0, 80)
  const summary = lines[0] ?? (status === 'error' ? 'Tool failed' : 'Tool completed')
  return { status, summary, lines }
}

function normalizePositiveLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  return rounded >= 1 ? rounded : fallback
}

function stripInjectedBlocksFromHistory(history: ChatHistory, userIndex: number, injectedCount: number): ChatHistory {
  const msg = history[userIndex]
  if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) return history
  if (injectedCount <= 0) return history
  if (msg.content.length <= injectedCount) return history

  const stripped: ChatHistory[number] = {
    ...msg,
    content: msg.content.slice(injectedCount),
  }

  return [...history.slice(0, userIndex), stripped, ...history.slice(userIndex + 1)]
}

async function commitPendingDurableCompressionState(args: {
  writer: Pick<SessionWriter, 'appendEvent' | 'flush'>
  filePath: string
  contextCollapseStoreByFilePath: Map<string, ContextCollapseStoreSnapshot>
  durableSnipCommit: Record<string, unknown> | null
  contextCollapseCommit: ContextCollapseCommittedEntry | null
}): Promise<void> {
  if (args.durableSnipCommit) {
    await args.writer.appendEvent(DURABLE_SNIP_COMMITTED_EVENT_NAME, args.durableSnipCommit)
  }
  if (args.contextCollapseCommit) {
    await args.writer.appendEvent(CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME, args.contextCollapseCommit)
  }
  await args.writer.flush()
  if (args.contextCollapseCommit) {
    args.contextCollapseStoreByFilePath.set(args.filePath, appendContextCollapseStoreEntry({
      snapshot: args.contextCollapseStoreByFilePath.get(args.filePath) ?? null,
      entry: args.contextCollapseCommit,
    }))
  }
}

function buildDurableSnipCommit(args: {
  phase: 'initial' | 'reactive_retry'
  state: RequestSnipState | null | undefined
}): Record<string, unknown> | null {
  if (!args.state?.applied || args.state.removals.length === 0) return null
  return {
    schemaVersion: 1,
    source: 'request_snip',
    phase: args.phase,
    estimatedTokensSaved: args.state.estimatedTokensSaved,
    removedMessageCount: args.state.removedMessageCount,
    compactBoundaryFingerprint: args.state.compactBoundaryFingerprint,
    baseProjectionFingerprint: args.state.baseProjectionFingerprint,
    sourceProjectionKind: args.state.sourceProjectionKind,
    removals: args.state.removals,
  }
}

function buildContextCollapseCommitEntry(args: {
  phase: 'initial' | 'reactive_retry'
  state: RequestCollapseState | null | undefined
  createdAtMs: number
}): ContextCollapseCommittedEntry | null {
  if (!args.state?.metadata || !args.state.commit) return null
  const phaseSegment = args.phase === 'initial' ? '' : `${args.phase}:`
  return createContextCollapseCommittedEntry({
    id: `request-collapse:app-server:${phaseSegment}${args.state.metadata.recapFingerprint}`,
    createdAtMs: args.createdAtMs,
    source: 'request_collapse',
    collapsedRange: args.state.commit.collapsedRange,
    compactBoundaryFingerprint: args.state.commit.compactBoundaryFingerprint,
    recapMessage: args.state.commit.recapMessage,
    metadata: args.state.metadata,
  })
}

export class TurnRunner {
  private readonly engine: Pick<ChatEngine, 'runTurn'>
  private readonly tools: ToolDefinition[]
  private readonly allowedSubagents: Array<{ name: string; description: string }>
  private readonly cwd: string
  private readonly env?: NodeJS.ProcessEnv
  private readonly platform?: string
  private readonly homedir?: string
  private readonly userInputManager: UserInputManager | null
  private readonly emitNotification: TurnRunnerNotificationEmitter
  private readonly defaultInputTtlMs: number
  private readonly maxPendingInputsPerThread: number
  private readonly ensureThreadFilePath?: (args: { threadId: string; cwd: string }) => Promise<string>
  private readonly runtimeFlags: RuntimeFlags
  private readonly runtimeFlagFingerprint: string
  private readonly threadFilePathById = new Map<string, string>()
  private readonly planSessionByThreadId = new Map<string, PlanSessionManager>()
  private readonly runningByThreadId = new Map<string, RunningTurn>()
  private readonly contextCollapseStoreByFilePath = new Map<string, ContextCollapseStoreSnapshot>()
  private readonly autoTitleAttemptedThreadIds = new Set<string>()
  private readonly autoTitleCheckedTopicPromptKeys = new Set<string>()

  constructor(args: TurnRunnerOptions) {
    this.engine = args.engine
    this.tools = args.tools
    this.allowedSubagents = args.allowedSubagents
    this.cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    this.env = args.env
    this.platform = args.platform
    this.homedir = args.homedir
    this.userInputManager = args.userInputManager ?? null
    this.emitNotification = args.emitNotification
    this.defaultInputTtlMs = normalizePositiveLimit(args.defaultInputTtlMs, DEFAULT_INPUT_TTL_MS)
    this.maxPendingInputsPerThread = normalizePositiveLimit(
      args.maxPendingInputsPerThread,
      DEFAULT_MAX_PENDING_INPUTS_PER_THREAD,
    )
    this.ensureThreadFilePath = args.ensureThreadFilePath
    this.runtimeFlags = args.runtimeFlags ?? createRuntimeFlags(this.env ?? process.env)
    this.runtimeFlagFingerprint = JSON.stringify(this.runtimeFlags)
  }

  private async getContextCollapseStoreSnapshot(filePath: string): Promise<ContextCollapseStoreSnapshot> {
    const cached = this.contextCollapseStoreByFilePath.get(filePath)
    if (cached) return cached
    const snapshot = await readContextCollapseStoreSnapshotFromSession({ filePath }).catch(() => ({
      schemaVersion: 1 as const,
      activeCompactBoundaryFingerprint: null,
      entries: [],
    }))
    this.contextCollapseStoreByFilePath.set(filePath, snapshot)
    return snapshot
  }

  private updateContextCollapseStoreActiveGeneration(filePath: string, history: ChatHistory): void {
    const boundaryIndex = findLatestCompactBoundaryIndex(history)
    if (boundaryIndex < 0) return
    const activeCompactBoundaryFingerprint =
      fingerprintCompactBoundaryMessage(history[boundaryIndex]!)
    this.contextCollapseStoreByFilePath.set(
      filePath,
      setContextCollapseStoreActiveCompactBoundaryFingerprint({
        snapshot: this.contextCollapseStoreByFilePath.get(filePath) ?? null,
        activeCompactBoundaryFingerprint,
      }),
    )
  }

  getPlanPath(threadId: string): string | null {
    const running = this.runningByThreadId.get(threadId)
    if (running?.planPath) return running.planPath
    return this.planSessionByThreadId.get(threadId)?.getPlanPath() ?? null
  }

  adoptPlanPath(threadId: string, planPath: string | null): void {
    if (!planPath) return
    const existing = this.planSessionByThreadId.get(threadId)
    if (existing) {
      existing.setPlanPath?.(planPath)
      return
    }
    const planSession = createPlanSessionManager({
      planDir: path.dirname(planPath),
      initialPlanPath: planPath,
    })
    this.planSessionByThreadId.set(threadId, planSession)
  }

  async startTurn(params: TurnStartRuntimeParams): Promise<{ turn: { id: string; threadId: string; status: TurnStatus } }> {
    const existing = this.runningByThreadId.get(params.threadId)
    if (existing) throw new Error(`Turn already running for thread: ${params.threadId}`)

    const cwd = params.cwd ? path.resolve(params.cwd) : this.cwd
    const runtimeConfig = await loadRuntimeConfig(this.env ?? process.env, cwd, {
      platform: this.platform,
      homedir: this.homedir,
    })
    const runtimeProfile = resolveRuntimeModelProfile({
      cfg: runtimeConfig,
      runtimeFlagFingerprint: this.runtimeFlagFingerprint,
    })
    const filePath = await this.resolveOrCreateThreadFilePath({
      threadId: params.threadId,
      cwd,
      model: runtimeProfile.model,
    })

    const initialMode = normalizeReplMode(params.mode, 'normal')
    let planSession = this.planSessionByThreadId.get(params.threadId) ?? null
    if (initialMode === 'plan' && !planSession) {
      planSession = createPlanSessionManager({ planDir: runtimeConfig.paths.planDir })
      this.planSessionByThreadId.set(params.threadId, planSession)
    }
    const planPath =
      initialMode === 'plan'
        ? planSession?.getPlanPath() ?? planSession?.startNewPlan() ?? null
        : planSession?.getPlanPath() ?? null

    const turnInput = buildTurnInput({
      rawText: params.input.text,
      mode: initialMode,
      planPath,
      includeExitPlanReminder: Boolean(params.includeExitPlanReminder),
    })
    const pendingInjectedBlocks = [...(params.pendingInjectedBlocks ?? [])]
    const commandRouting = resolveCommandRouting(params.input.text)
    const compactInstructions = commandRouting.isExactCompact ? (commandRouting.commandArgs as string) : ''

    const turnId = randomUUID()
    const running: RunningTurn = {
      turnId,
      traceId: randomUUID(),
      seq: 0,
      threadId: params.threadId,
      filePath,
      cwd,
      inputText: params.input.text,
      modelInputText: turnInput.modelUserText,
      modelUserContent: [...turnInput.semanticBlocks, ...pendingInjectedBlocks, ...turnInput.userBlocks],
      semanticBlockCount: turnInput.semanticBlocks.length,
      pendingInjectedBlockCount: pendingInjectedBlocks.length,
      onPendingInjectedBlocksConsumed: params.onPendingInjectedBlocksConsumed ?? null,
      replMode: initialMode,
      planSession,
      planPath,
      abortController: new AbortController(),
      inputStore: new TurnInputStore({
        threadId: params.threadId,
        turnId,
        defaultInputTtlMs: this.defaultInputTtlMs,
        maxPendingInputs: this.maxPendingInputsPerThread,
      }),
      writer: null,
      pendingEventWrites: [],
      inputExpiryTimers: new Map(),
      compact: {
        isCommand: commandRouting.isExactCompact,
        instructions: compactInstructions,
      },
      runtimeConfig,
      runtimeProfile,
      toolNameByUseId: new Map<string, string>(),
      toolInputByUseId: new Map<string, unknown>(),
    }
    this.runningByThreadId.set(params.threadId, running)

    const contextMeterBudgetRaw = this.resolveContextMeterBudgetRaw(running.runtimeProfile)

    this.emitTurnNotification(running, 'turn/started', 'system', {
      turn: {
        id: running.turnId,
        threadId: running.threadId,
        status: 'running',
        mode: running.replMode,
      },
      contextMeter: {
        schemaVersion: 1,
        budgetRaw: contextMeterBudgetRaw,
      },
      input: {
        text: running.inputText,
      },
    })

    void this.runTurnInBackground(running).catch((err) => {
      this.runningByThreadId.delete(running.threadId)
      this.emitTurnNotification(running, 'turn/failed', 'system', {
        turn: {
          id: running.turnId,
          threadId: running.threadId,
          status: 'failed',
        },
        error: err instanceof Error ? err.message : String(err),
      })
    })

    return {
      turn: {
        id: running.turnId,
        threadId: running.threadId,
        status: 'running',
      },
    }
  }

  async interruptTurn(params: TurnInterruptParams): Promise<{}> {
    const running = this.runningByThreadId.get(params.threadId)
    if (!running || running.turnId !== params.turnId) {
      throw new Error(`Turn not running: ${params.threadId}/${params.turnId}`)
    }

    this.resolvePendingInputs(running, { status: 'canceled', reason: 'turn_interrupted' })
    running.abortController.abort()
    return {}
  }

  async submitInput(params: TurnInputSubmitParams): Promise<TurnInputSubmitResult> {
    if (!this.userInputManager) {
      throw new Error('Input submission unavailable: user input manager is not configured')
    }

    const running = this.runningByThreadId.get(params.threadId)
    if (!running || running.turnId !== params.turnId) {
      return { accepted: false, status: 'not_pending' }
    }

    let inputId = params.inputId
    if (!running.inputStore.hasInput(inputId)) {
      const resolved = running.inputStore.resolveInputIdFromToolUseId(params.toolUseId ?? params.inputId)
      if (resolved) inputId = resolved
    }

    const out = running.inputStore.submitInput({
      inputId,
      answers: params.answers,
      submissionId: params.submissionId,
    })

    if (out.status === 'accepted' && out.toolUseId) {
      const accepted = this.userInputManager.submitAnswers(out.toolUseId, params.answers)
      if (!accepted) {
        return { accepted: false, status: 'not_pending' }
      }
    }

    if (out.transition) {
      this.emitResolvedInput(running, out.transition)
    }

    return {
      accepted: out.accepted,
      status: out.status,
    }
  }

  private async runTurnInBackground(running: RunningTurn): Promise<void> {
    let writer: SessionWriter | null = null
    let status: TurnStatus = 'running'
    let errorMessage: string | null = null
    let pendingDurableSnipCommit: Record<string, unknown> | null = null
    let pendingContextCollapseCommit: ContextCollapseCommittedEntry | null = null
    let titleUpdated = false

    try {
      writer = await SessionWriter.openExisting({ filePath: running.filePath })
      running.writer = writer
      await writer.appendEvent('app_turn_started', {
        traceId: running.traceId,
        threadId: running.threadId,
        turnId: running.turnId,
        cwd: running.cwd,
      })
      const replay = await readSessionFile(running.filePath)
      const history = replay.history
      const initialCollapseStoreSnapshot = await this.getContextCollapseStoreSnapshot(running.filePath)
      const initialDurableSnipState = scopeDurableSnipStateToHistory({
        state: await readDurableSnipStateFromSession({ filePath: running.filePath }).catch(() => null),
        history,
      })
      const initialDurableToolResultContentReplacementState =
        scopeDurableToolResultContentReplacementStateToHistory({
          state: await readDurableToolResultContentReplacementStateFromSession({ filePath: running.filePath }).catch(
            () => null,
          ),
          history,
        })

      const userMsg: Msg = {
        id: `user-${Date.now()}-${running.turnId}`,
        role: 'user',
        content: running.inputText,
        timestamp: new Date(),
      }
      await writer.appendStableMsg(userMsg)

      const deferredToolExposureEnabled = this.runtimeFlags.deferredToolExposureEnabled === true
      const { allowTools, disallowedTools } = resolveToolFilters({
        env: this.env ?? process.env,
        interactive: true,
      })
      const filteredTools = applyToolFilters({
        tools: this.tools,
        allowTools,
        disallowedTools,
      })
      const toolExposure = resolveDeferredToolExposureForTurn({
        cwd: running.cwd,
        tools: filteredTools,
        deferredToolExposureEnabled,
        toolSearchEnabled: !disallowedTools?.includes('ToolSearch'),
        explicitSessionKey: `app-server:${running.threadId}`,
        toolSearchEngine: this.runtimeFlags.toolSearchEngine,
      })
      const exposureInjectedBlockCount = toolExposure.injectedPromptBlocks.length
      const user = {
        role: 'user' as const,
        content: [...toolExposure.injectedPromptBlocks, ...running.modelUserContent],
      }
      const system = buildSystemPrompt({
        allowedSubagents: this.allowedSubagents,
        cwd: running.cwd,
        model: running.runtimeProfile.model,
        variant: resolveSystemPromptVariant({ deferredToolExposureEnabled }),
      }, {
        env: this.env ?? process.env,
      })
      const tools = toolExposure.toolsForTurn

      let assistantText = ''
      let nextHistoryForSnapshot: ChatHistory = history
      const shouldAutoGenerateTitle = !running.compact.isCommand
      const emitStreamTurnEvent = (event: StreamEvent) => {
        this.emitTurnNotification(running, 'turn/event', sourceFromStreamEvent(event), {
          turnId: running.turnId,
          threadId: running.threadId,
          event,
        })
      }
      const turnTrace = {
        traceId: running.traceId,
        threadId: running.threadId,
        turnId: running.turnId,
      }
      const getReplMode = () => running.replMode
      const setReplMode = (nextMode: ReplMode) => {
        const transition = resolveReplModeTransition({ current: running.replMode, next: nextMode })
        if (!transition) return
        if (running.planSession) {
          if (transition.to === 'plan' && !running.planPath) {
            running.planPath = running.planSession.getPlanPath() ?? running.planSession.startNewPlan()
          } else {
            running.planPath = running.planSession.getPlanPath()
          }
        }
        running.replMode = transition.to
        this.emitTurnNotification(running, 'turn/modeChanged', 'engine', {
          threadId: running.threadId,
          turnId: running.turnId,
          previousMode: transition.from,
          mode: transition.to,
        })
      }

      const onEvent = (event: StreamEvent) => {
        if (event.type === 'approval_request') {
          const input = running.inputStore.createPendingInput({
            toolUseId: event.toolUseId,
            kind: 'approval',
            payload: {
              toolName: event.toolName,
              action: event.action,
              effectiveDecision: event.effectiveDecision,
              ...(event.suggestions ? { suggestions: event.suggestions } : {}),
              ...(event.workspaceRequest !== undefined ? { workspaceRequest: event.workspaceRequest } : {}),
            },
          })
          this.armInputExpiryTimer(running, input)
          this.emitTurnNotification(running, 'turn/inputRequested', 'policy', {
            threadId: running.threadId,
            turnId: running.turnId,
            input,
          })
          this.appendAppEvent(running, 'app_input_requested', input)
          return
        }

        if (event.type === 'ask_user_question') {
          const input = running.inputStore.createPendingInput({
            toolUseId: event.toolUseId,
            kind: 'ask_user_question',
            payload: {
              questions: event.questions,
            },
          })
          this.armInputExpiryTimer(running, input)
          this.emitTurnNotification(running, 'turn/inputRequested', 'tool', {
            threadId: running.threadId,
            turnId: running.turnId,
            input,
          })
          this.appendAppEvent(running, 'app_input_requested', input)
          return
        }

        if (event.type === 'assistant_delta') assistantText += event.text
        if (event.type === 'tool_start') {
          running.toolNameByUseId.set(event.id, event.name)
          this.appendAppEvent(running, 'app_tool_event', {
            threadId: running.threadId,
            turnId: running.turnId,
            toolUseId: event.id,
            toolName: event.name,
            phase: 'start',
            status: 'running',
            summary: `${event.name} running`,
          })
        } else if (event.type === 'tool_input') {
          const toolName = running.toolNameByUseId.get(event.id)
          running.toolInputByUseId.set(event.id, event.input)
          const toolInput =
            event.input && typeof event.input === 'object' && !Array.isArray(event.input)
              ? (event.input as Record<string, unknown>)
              : null
          this.appendAppEvent(running, 'app_tool_event', {
            threadId: running.threadId,
            turnId: running.turnId,
            toolUseId: event.id,
            ...(toolName ? { toolName } : {}),
            phase: 'update',
            ...(toolInput ? { input: toolInput } : {}),
            ...(compactParamsText(event.input) ? { paramsText: compactParamsText(event.input) } : {}),
          })
        } else if (event.type === 'tool_update') {
          const toolName = running.toolNameByUseId.get(event.id)
          const line = toToolUpdateLine(event)
          if (line) {
            this.appendAppEvent(running, 'app_tool_event', {
              threadId: running.threadId,
              turnId: running.turnId,
              toolUseId: event.id,
              ...(toolName ? { toolName } : {}),
              phase: 'update',
              line,
            })
          }
        } else if (event.type === 'tool_end') {
          const toolName = running.toolNameByUseId.get(event.id)
          const payload = toToolEndPayload(event)
          const patchStartLineNumber = resolveEditPatchStartLineNumber({
            cwd: running.cwd,
            toolName,
            isError: Boolean(event.result.is_error),
            toolInput: running.toolInputByUseId.get(event.id),
          })
          this.appendAppEvent(running, 'app_tool_event', {
            threadId: running.threadId,
            turnId: running.turnId,
            toolUseId: event.id,
            ...(toolName ? { toolName } : {}),
            phase: 'end',
            status: payload.status,
            summary: payload.summary,
            lines: payload.lines,
            ...(patchStartLineNumber !== null ? { patchStartLineNumber } : {}),
          })
          running.toolNameByUseId.delete(event.id)
          running.toolInputByUseId.delete(event.id)
          if (patchStartLineNumber !== null) {
            event = { ...event, patchStartLineNumber } as StreamEvent
          }
        }
        emitStreamTurnEvent(event)
      }

      if (running.abortController.signal.aborted) {
        throw new Error('Request aborted')
      }

      let cacheEditingEnabledForSnapshot = false
      if (running.compact.isCommand) {
        await this.consumePendingInjectedBlocksForDispatch(running)
        await writer.appendEvent('compact_started', { source: 'manual' })
        const manualCompactProjection = buildContextProjection({
          history,
          durableState: {
            ...(initialDurableSnipState ? { snip: initialDurableSnipState } : {}),
            collapse: initialCollapseStoreSnapshot,
            ...(initialDurableToolResultContentReplacementState
              ? { toolResultContentReplacement: initialDurableToolResultContentReplacementState }
              : {}),
          },
        })
        const manualCompactPersistenceProjection = buildContextProjection({
          history,
          durableState: {
            ...(initialDurableSnipState ? { snip: initialDurableSnipState } : {}),
            collapse: initialCollapseStoreSnapshot,
          },
        })
        const compactResult = await runCompactFlow({
          source: 'manual',
          instructions: running.compact.instructions,
          engine: this.engine as ChatEngine,
          previousHistory: manualCompactProjection.modelFacingBaseline,
          persistenceHistory: manualCompactPersistenceProjection.modelFacingBaseline,
          excludePersistenceToolUseIds: manualCompactProjection.durableState.toolResultContentReplacement.replacements.map(
            (replacement) => replacement.toolUseId,
          ),
          keepLastTurns: MANUAL_COMPACT_KEEP_LAST_TURNS,
          system,
          cwd: running.cwd,
          signal: running.abortController.signal,
          promptBudget: this.resolvePromptBudgetConfig(running.runtimeProfile),
          model: running.runtimeProfile.model,
          thinkingEnabled: running.runtimeProfile.thinkingMode,
          mode: running.replMode,
          getReplMode,
          setReplMode,
          getPlanPath: () => running.planPath,
          onStreamEvent: emitStreamTurnEvent,
        })
        if (running.abortController.signal.aborted) {
          throw new Error('Request aborted')
        }
        nextHistoryForSnapshot = compactResult.compactedHistory
        const compactBoundary = readCompactBoundaryMeta(nextHistoryForSnapshot[0] ?? null)
        if (compactBoundary) {
          emitStreamTurnEvent({ type: 'compact_boundary', boundary: compactBoundary })
        }
        assistantText = COMPACT_BANNER_TEXT
        emitStreamTurnEvent({ type: 'assistant_delta', text: assistantText })
        await writer.appendEvent('compact_succeeded', {
          source: 'manual',
          summaryChars: compactResult.summary.length,
        })
      } else {
        const promptBudget = this.resolvePromptBudgetConfig(running.runtimeProfile)
        const cacheEditingEnabled = isAnthropicCacheEditingEnabled({
          provider: running.runtimeProfile.provider,
          baseUrl: running.runtimeProfile.baseUrl,
          env: this.env ?? process.env,
        })
        cacheEditingEnabledForSnapshot = cacheEditingEnabled
        const prepared = prepareTurnRequestProjection({
          system,
          history,
          user,
          budgetConfig: promptBudget,
          durableState: {
            ...(initialDurableSnipState ? { snip: initialDurableSnipState } : {}),
            collapse: initialCollapseStoreSnapshot,
            ...(initialDurableToolResultContentReplacementState
              ? { toolResultContentReplacement: initialDurableToolResultContentReplacementState }
              : {}),
          },
          enableCacheEditing: cacheEditingEnabled,
          enableTimeBasedMicroCompact: cacheEditingEnabled,
        })
        let executionHistory = prepared.persistedHistory as ChatHistory
        let executionRequestHistory = prepared.requestHistory as ChatHistory
        let executionUser = prepared.requestUser as typeof user
        let executionCacheEditPlan = prepared.cacheEditPlan
        const collapseFact = prepared.strategyFacts.collapse
        const snipFact = prepared.strategyFacts.snip
        const collapseCompactBoundaryFingerprint =
          prepared.contextProjection.durableState.collapse.compactBoundaryFingerprint
        const activeCompactBoundaryFingerprint = prepared.contextProjection.facts.activeCompactBoundaryFingerprint
        const collapseRecapMessage = prepared.stack.collapsedHistory[0]
        const collapseRecapSurvivedRequestProjection = collapseRecapMessage
          ? requestHistoryContainsExactMessage({ messages: prepared.requestHistory, message: collapseRecapMessage })
          : false

        const rebasedCollapseHeadMessageCount = rebaseCollapseHeadCountAfterDurableSnip({
          collapsedHeadMessageCount: collapseFact.collapsedHeadMessageCount,
          snipRemovals: prepared.stack.snipRemovals,
          baselineMessages: prepared.contextProjection.modelFacingBaseline,
        })
        const canPersistDurableSnip =
          !prepared.contextProjection.durableState.collapse.applied &&
          (!collapseFact.applied || rebasedCollapseHeadMessageCount !== null)
        if (canPersistDurableSnip && snipFact.applied && prepared.stack.snipRemovals.length > 0) {
          const newRemovals = prepared.stack.snipRemovals.map((removal) => ({
            kind: removal.kind,
            startIndex: removal.startIndex,
            endIndexExclusive: removal.endIndexExclusive,
            reason: removal.reason,
            removedMessageFingerprints: removal.removedMessageFingerprints,
            removedMessageIdentities: removal.removedMessageIdentities,
          }))
          const snipSnapshot = mergeDurableSnipSnapshot({
            existingState: initialDurableSnipState,
            appliedExistingRemovals: prepared.contextProjection.durableState.snip.removals,
            newRemovals,
            compactBoundaryFingerprint: activeCompactBoundaryFingerprint,
            baseProjectionFingerprint: prepared.contextProjection.facts.modelFacingBaselineFingerprint,
            sourceProjectionKind: 'model_facing_baseline',
          })
          pendingDurableSnipCommit = buildDurableSnipCommit({
            phase: 'initial',
            state: {
              applied: true,
              estimatedTokensSaved: snipFact.estimatedTokensSaved,
              removedMessageCount: snipSnapshot.removals.reduce(
                (sum, removal) => sum + removal.endIndexExclusive - removal.startIndex,
                0,
              ),
              compactBoundaryFingerprint: activeCompactBoundaryFingerprint,
              baseProjectionFingerprint: snipSnapshot.baseProjectionFingerprint,
              sourceProjectionKind: snipSnapshot.sourceProjectionKind,
              removals: snipSnapshot.removals,
            },
          })
        }
        const collapseCommit = buildContextCollapseCommitStateCandidate({
          applied: collapseFact.applied,
          metadata: collapseFact.metadata,
          compactBoundaryFingerprint: collapseCompactBoundaryFingerprint,
          recapMessage: collapseRecapMessage,
          recapSurvivedRequestProjection: collapseRecapSurvivedRequestProjection,
          hasSameTurnSnip: prepared.stack.snipRemovals.length > 0,
          collapsedHeadMessageCount: rebasedCollapseHeadMessageCount,
        })
        pendingContextCollapseCommit = buildContextCollapseCommitEntry({
          phase: 'initial',
          createdAtMs: Date.now(),
          state: {
            applied: collapseFact.applied,
            collapsedHeadMessageCount: collapseFact.collapsedHeadMessageCount,
            estimatedTokensSaved: collapseFact.estimatedTokensSaved,
            metadata: collapseFact.metadata,
            commit: collapseCommit,
          },
        })

        const runEngineTurn = async () =>
          this.engine.runTurn({
            history: executionHistory,
            requestHistory: executionRequestHistory,
            user,
            requestUser: executionUser,
            cacheEditPlan: executionCacheEditPlan,
            system,
            tools,
            ...(toolExposure.resolveToolsForCall ? { resolveToolsForCall: toolExposure.resolveToolsForCall } : {}),
            onEvent,
            cwd: running.cwd,
            signal: running.abortController.signal,
            promptBudget,
            model: running.runtimeProfile.model,
            thinkingEnabled: running.runtimeProfile.thinkingMode,
            exec: {
              interactive: true,
              replMode: running.replMode,
              getReplMode,
              setReplMode,
              getPlanPath: () => running.planPath,
              planPath: running.planPath,
              trace: turnTrace,
              ...(toolExposure.toolExposureSessionKey
                ? { toolExposureSessionKey: toolExposure.toolExposureSessionKey }
                : {}),
            },
          })

        await this.consumePendingInjectedBlocksForDispatch(running)
        let nextHistory: ChatHistory
        try {
          nextHistory = (await runEngineTurn()) as ChatHistory
        } catch (error) {
          const abortLike = running.abortController.signal.aborted || isAbortLikeError(error)
          const reactiveErrorInfo = !abortLike ? classifyReactiveCompactError(error) : null
          if (!abortLike && reactiveErrorInfo && isReactiveCompactEligibleError(error)) {
            const initialCollapseCommit = pendingContextCollapseCommit
            if (initialCollapseCommit) {
              try {
                await commitPendingDurableCompressionState({
                  writer,
                  filePath: running.filePath,
                  contextCollapseStoreByFilePath: this.contextCollapseStoreByFilePath,
                  durableSnipCommit: null,
                  contextCollapseCommit: initialCollapseCommit,
                })
                pendingContextCollapseCommit = null
              } catch {
                // Reactive overflow recovery should not be suppressed by best-effort
                // persistence of the already-prepared request collapse snapshot.
              }
            }

            const compression = createContextCompressionService({
              cfg: running.runtimeConfig,
              engine: this.engine as ChatEngine,
              mode: running.replMode,
              getReplMode,
              setReplMode,
              getPlanPath: () => running.planPath,
              cwd: running.cwd,
              signal: running.abortController.signal,
              promptBudget,
              model: running.runtimeProfile.model,
              thinkingEnabled: running.runtimeProfile.thinkingMode,
              onCompactLifecycle: (event) => {
                if (event.type === 'compact_started') {
                  this.appendAppEvent(running, 'compact_started', { source: event.source })
                } else if (event.type === 'compact_succeeded') {
                  this.appendAppEvent(running, 'compact_succeeded', { source: event.source })
                } else {
                  this.appendAppEvent(running, 'compact_failed', {
                    source: event.source,
                    error: event.error,
                  })
                }
              },
              getSessionFilePath: () => running.filePath,
              getContextCollapseStoreSnapshot: () => this.getContextCollapseStoreSnapshot(running.filePath),
            })
            const triggerReason: CompactTriggerReason = {
              kind: 'reactive_error',
              detail: reactiveErrorInfo.detail.slice(0, 200),
            }
            let reactivePrepared: ReactiveCompactPreparation
            try {
              reactivePrepared = await compression.runReactiveCompact({
                contextWindowTokens: running.runtimeProfile.contextWindowTokens,
                previousHistory: executionHistory,
                user: executionUser,
                system,
                triggerReason,
              })
            } catch (reactiveError) {
              const reactiveAbortLike = running.abortController.signal.aborted || isAbortLikeError(reactiveError)
              throw reactiveAbortLike ? reactiveError : error
            }

            if (reactivePrepared.reactiveCompactState.applied && reactivePrepared.reactiveCompactState.strategy) {
              this.appendAppEvent(running, 'reactive_compact_applied', {
                triggerKind: reactiveErrorInfo.kind,
                triggerDetail: reactiveErrorInfo.detail,
                strategy: reactivePrepared.reactiveCompactState.strategy,
              })
            }
            executionHistory = reactivePrepared.history
            executionRequestHistory = reactivePrepared.requestHistory
            executionUser = reactivePrepared.user as typeof user
            executionCacheEditPlan = reactivePrepared.cacheEditPlan
            pendingDurableSnipCommit = buildDurableSnipCommit({
              phase: 'reactive_retry',
              state: reactivePrepared.snipState,
            })
            pendingContextCollapseCommit = buildContextCollapseCommitEntry({
              phase: 'reactive_retry',
              createdAtMs: Date.now(),
              state: reactivePrepared.collapseState,
            })
            nextHistory = (await runEngineTurn()) as ChatHistory
          } else {
            throw error
          }
        }
        if (running.abortController.signal.aborted) {
          throw new Error('Request aborted')
        }
        nextHistoryForSnapshot =
          running.semanticBlockCount + running.pendingInjectedBlockCount + exposureInjectedBlockCount > 0
            ? stripInjectedBlocksFromHistory(
                nextHistory as ChatHistory,
                executionHistory.length,
                running.semanticBlockCount + running.pendingInjectedBlockCount + exposureInjectedBlockCount,
              )
            : (nextHistory as ChatHistory)
      }

      const historyForSnapshot = cacheEditingEnabledForSnapshot
        ? stampMissingAssistantMessageTimestamps(nextHistoryForSnapshot, new Date().toISOString())
        : nextHistoryForSnapshot

      if (assistantText.trim()) {
        await writer.appendStableMsg({
          id: `assistant-${Date.now()}-${running.turnId}`,
          role: 'assistant',
          content: assistantText,
          timestamp: new Date(),
        })
      }
      await writer.appendHistorySnapshot(historyForSnapshot)
      this.updateContextCollapseStoreActiveGeneration(running.filePath, historyForSnapshot)
      const firstUserPrompt = firstUserPromptFromHistory(history) ?? running.inputText
      const uiMsgCount = historyForSnapshot.filter((message) => {
        if (isCompactBoundaryMessage(message)) return false
        return message.role === 'user' || message.role === 'assistant'
      }).length
      await writer.appendEvent('ui_stats', {
        uiMsgCount,
        firstUserPrompt,
        lastUserPrompt: running.inputText,
      })
      if (shouldAutoGenerateTitle) {
        const generatedTitle = await maybeAutoGenerateSessionTitle({
          filePath: running.filePath,
          engine: this.engine,
          cwd: running.cwd,
          attemptedSessionIds: this.autoTitleAttemptedThreadIds,
          checkedTopicPromptKeys: this.autoTitleCheckedTopicPromptKeys,
          writer,
          userText: firstUserPrompt,
          topicUserText: running.inputText,
          assistantText,
          signal: running.abortController.signal,
        }).catch(() => null)
        if (generatedTitle) {
          titleUpdated = true
        }
      }
      status = 'completed'
    } catch (err) {
      status = running.abortController.signal.aborted ? 'interrupted' : 'failed'
      errorMessage = err instanceof Error ? err.message : String(err)
    } finally {
      if (status === 'interrupted') {
        this.resolvePendingInputs(running, { status: 'canceled', reason: 'turn_interrupted' })
      } else if (status !== 'completed') {
        this.resolvePendingInputs(running, { status: 'failed', reason: 'turn_failed' })
      } else {
        this.resolvePendingInputs(running, { status: 'failed', reason: 'turn_completed_with_pending_input' })
      }

      if (writer) {
        const flushError = await writer.flush().then(() => null).catch((err) => err)
        if (flushError && status === 'completed') {
          status = 'failed'
          errorMessage = flushError instanceof Error ? flushError.message : String(flushError)
        }
        if (status === 'completed') {
          const durableCommitError = await (async () => {
            try {
              await commitPendingDurableCompressionState({
                writer,
                filePath: running.filePath,
                contextCollapseStoreByFilePath: this.contextCollapseStoreByFilePath,
                durableSnipCommit: pendingDurableSnipCommit,
                contextCollapseCommit: pendingContextCollapseCommit,
              })
              return null
            } catch (err) {
              return err
            }
          })()
          if (durableCommitError) {
            status = 'failed'
            errorMessage = durableCommitError instanceof Error ? durableCommitError.message : String(durableCommitError)
          }
        }
      }

      this.appendAppEvent(running, 'app_turn_ended', {
        traceId: running.traceId,
        threadId: running.threadId,
        turnId: running.turnId,
        status,
        endedAt: new Date().toISOString(),
        ...(errorMessage ? { error: errorMessage } : {}),
      })
      await Promise.all(running.pendingEventWrites)

      if (writer) {
        await writer.shutdown().catch(() => undefined)
      }
      this.clearAllInputExpiryTimers(running)
      running.writer = null
      this.runningByThreadId.delete(running.threadId)
    }

    if (status === 'completed') {
      if (titleUpdated) {
        this.emitTurnNotification(running, 'thread/updated', 'system', {
          threadId: running.threadId,
        })
      }
      this.emitTurnNotification(running, 'turn/completed', 'engine', {
        turn: {
          id: running.turnId,
          threadId: running.threadId,
          status,
        },
      })
      return
    }

    this.emitTurnNotification(running, 'turn/failed', 'system', {
      turn: {
        id: running.turnId,
        threadId: running.threadId,
        status,
      },
      error: String(errorMessage),
    })
  }

  private resolvePromptBudgetConfig(runtimeProfile: RuntimeModelProfile): ContextBudgetConfig | null {
    const contextWindowTokens = runtimeProfile.contextWindowTokens
    if (!contextWindowTokens) return null

    return {
      contextWindowTokens,
      effectiveContextWindowPercent: runtimeProfile.effectiveContextWindowPercent,
      autoCompactLimitPercent: runtimeProfile.autoCompactTokenLimitPercent,
      baselineTokens: runtimeProfile.baselineTokens,
    }
  }

  private resolveContextMeterBudgetRaw(runtimeProfile: RuntimeModelProfile): ContextMeterBudgetRaw | null {
    const contextWindowTokens = runtimeProfile.contextWindowTokens
    if (!contextWindowTokens) return null

    return normalizeContextMeterBudgetRaw({
      model: runtimeProfile.model,
      provider: runtimeProfile.provider,
      source: runtimeProfile.contextWindowTokensSource,
      boundModel: runtimeProfile.contextWindowTokensBoundModel ?? null,
      profileFingerprint: runtimeProfile.fingerprint,
      config: {
        contextWindowTokens,
        effectiveContextWindowPercent: runtimeProfile.effectiveContextWindowPercent,
        autoCompactLimitPercent: runtimeProfile.autoCompactTokenLimitPercent,
        baselineTokens: runtimeProfile.baselineTokens,
      },
    })
  }

  private resolvePendingInputs(
    running: RunningTurn,
    args: { status: 'canceled' | 'expired' | 'failed'; reason?: string },
  ): void {
    const resolved = running.inputStore.resolveAllPending(args)
    for (const input of resolved) {
      this.emitResolvedInput(running, input)
    }
  }

  private async consumePendingInjectedBlocksForDispatch(running: RunningTurn): Promise<void> {
    if (running.pendingInjectedBlockCount <= 0) return
    const callback = running.onPendingInjectedBlocksConsumed
    if (!callback) return
    running.onPendingInjectedBlocksConsumed = null
    await callback({
      threadId: running.threadId,
      turnId: running.turnId,
    })
  }

  private emitResolvedInput(running: RunningTurn, input: InputResolvedPayload): void {
    this.clearInputExpiryTimer(running, input.inputId)
    this.emitTurnNotification(running, 'turn/inputResolved', sourceFromInputKind(input.kind), {
      threadId: running.threadId,
      turnId: running.turnId,
      input,
    })
    this.appendAppEvent(running, 'app_input_resolved', input)
  }

  private emitTurnNotification(
    running: RunningTurn,
    method: string,
    source: InputEnvelopeMeta['source'],
    params: Record<string, unknown>,
  ): void {
    const seq = running.seq + 1
    running.seq = seq
    const ts = new Date().toISOString()
    const eventId = `${running.turnId}:${seq}`
    this.emitNotification(method, {
      traceId: running.traceId,
      seq,
      ts,
      eventId,
      trace: {
        traceId: running.traceId,
        threadId: running.threadId,
        turnId: running.turnId,
        eventId,
        replaySeq: seq,
      },
      source,
      ...params,
    })
  }

  private async resolveThreadFilePath(args: { threadId: string; cwd: string }): Promise<string | null> {
    return findSessionFileBySessionId({
      cwd: args.cwd,
      sessionId: args.threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
  }

  private async resolveOrCreateThreadFilePath(args: { threadId: string; cwd: string; model: string }): Promise<string> {
    if (this.ensureThreadFilePath) {
      const filePath = await this.ensureThreadFilePath(args)
      this.threadFilePathById.set(args.threadId, filePath)
      return filePath
    }

    const knownPath = this.threadFilePathById.get(args.threadId)
    if (knownPath) {
      const exists = await fs
        .access(knownPath)
        .then(() => true)
        .catch(() => false)
      if (exists) return knownPath
      this.threadFilePathById.delete(args.threadId)
    }

    const candidateCwds = Array.from(new Set([args.cwd, this.cwd]))
    for (const cwd of candidateCwds) {
      const existing = await this.resolveThreadFilePath({ threadId: args.threadId, cwd })
      if (!existing) continue
      this.threadFilePathById.set(args.threadId, existing)
      return existing
    }

    const created = await SessionWriter.createNew({
      cwd: args.cwd,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
      model: args.model,
      sessionId: args.threadId,
    })
    await created.writer.shutdown()
    this.threadFilePathById.set(args.threadId, created.filePath)
    return created.filePath
  }

  private appendAppEvent(running: RunningTurn, name: string, data: Record<string, unknown>): void {
    if (!running.writer) return
    const write = running.writer.appendEvent(name, data).catch(() => undefined)
    running.pendingEventWrites.push(write)
  }

  private armInputExpiryTimer(running: RunningTurn, input: InputRequestedPayload): void {
    this.clearInputExpiryTimer(running, input.inputId)
    const expiresAt = Date.parse(input.expiresAt)
    if (!Number.isFinite(expiresAt)) return
    const delayMs = Math.max(0, expiresAt - Date.now() + 1)
    const timer = setTimeout(() => {
      running.inputExpiryTimers.delete(input.inputId)
      this.expirePendingInput(running, input)
    }, delayMs)
    if (typeof timer.unref === 'function') timer.unref()
    running.inputExpiryTimers.set(input.inputId, timer)
  }

  private clearInputExpiryTimer(running: RunningTurn, inputId: string): void {
    const timer = running.inputExpiryTimers.get(inputId)
    if (!timer) return
    clearTimeout(timer)
    running.inputExpiryTimers.delete(inputId)
  }

  private clearAllInputExpiryTimers(running: RunningTurn): void {
    for (const timer of running.inputExpiryTimers.values()) {
      clearTimeout(timer)
    }
    running.inputExpiryTimers.clear()
  }

  private expirePendingInput(running: RunningTurn, input: InputRequestedPayload): void {
    const active = this.runningByThreadId.get(running.threadId)
    if (!active || active.turnId !== running.turnId) return

    const now = new Date(Date.parse(input.expiresAt) + 1).toISOString()
    const out = running.inputStore.submitInput({
      inputId: input.inputId,
      answers: {},
      now,
    })
    if (out.transition) {
      this.emitResolvedInput(running, out.transition)
    }
    if (out.status === 'expired' && out.toolUseId && this.userInputManager) {
      this.userInputManager.reject(out.toolUseId, new Error('Input expired'))
    }
  }
}

export const __turnRunnerTestOnly = {
  compactParamsText,
  resolveEditPatchStartLineNumber,
  flattenPromptText,
  firstUserPromptFromHistory,
  extractAssistantText,
  toToolUpdateLine,
  toToolEndPayload,
  normalizePositiveLimit,
  stripInjectedBlocksFromHistory,
  commitPendingDurableCompressionState,
}
