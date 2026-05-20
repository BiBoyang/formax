import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ContextDiagnosticsPayload } from '../chat/context/contextDiagnostics.js'
import { resolveContextDiagnosticsOutputFormat } from '../chat/context/contextDiagnostics.js'
import {
  JSON_RPC_ERRORS,
  type JsonRpcErrorResponse,
  type JsonRpcSuccessResponse,
  makeErrorResponse,
  makeSuccessResponse,
  type ParsedRpcMessage,
} from './jsonrpc.js'
import {
  APP_SERVER_PROTOCOL_VERSION,
  parseCommandDispatchParams,
  parseInitializeParams,
  parseThreadArchiveParams,
  parseThreadByIdParams,
  parseThreadGroupHideParams,
  parseThreadListParams,
  parseThreadMessagesParams,
  parseThreadRenameParams,
  parseThreadReplayParams,
  parseThreadStartParams,
  parseTurnInputSubmitParams,
  parseTurnInterruptParams,
  parseTurnStartParams,
} from './protocol.js'
import {
  ThreadStore,
  type ThreadListResult,
  type ThreadMessagesResult,
  type ThreadReadResult,
  type ThreadResumeResult,
} from './threadStore.js'
import { DEFAULT_INPUT_TTL_MS, DEFAULT_MAX_PENDING_INPUTS_PER_THREAD, TurnRunner } from './turnRunner.js'
import {
  createInitialThreadRuntimeState,
  extractThreadIdFromNotificationParams,
  reduceThreadRuntimeState,
  type ThreadRuntimeState,
} from './threadStateReducer.js'
import { createSlashCommandRegistry } from '../features/commands/registry.js'
import {
  createInitialTranscriptProjectionState,
  mapTurnNotificationToCanonicalEvents,
  normalizeReplMode,
  reduceTranscriptProjection,
  resolveCommandRouting,
  shouldInjectExitPlanReminder,
  type TranscriptProjectionState,
} from '@formax/semantics'
import { buildReplayStateSnapshot, type ReplayStateSnapshot } from './replayStateSnapshot.js'
import type { PromptBlock } from '../prompts/index.js'
import type { SessionMemoryRestoreSummary } from '../chat/context/sessionMemory.js'
import type { CompactBoundaryMeta } from '../chat/context/compact.js'

const DEFAULT_MAX_REPLAY_EVENTS_PER_THREAD = 2000
const ANSI_SGR_RE = /\u001b\[[0-9;]*m/g

type ReplayEntry = {
  replaySeq: number
  method: string
  params?: Record<string, unknown>
}

export type AppServerInfo = {
  name: 'formax'
  version: string
}

export type AppServerState = {
  initializeCompleted: boolean
  initializedNotified: boolean
}

export type AppServerOptions = {
  info: AppServerInfo
  threadStore?: Pick<ThreadStore, 'startThread' | 'resumeThread' | 'listThreads' | 'readThread' | 'listThreadMessages'> &
    Partial<Pick<ThreadStore, 'renameThread' | 'archiveThread' | 'unarchiveThread' | 'hideThreadGroup'>>
  turnRunner?: Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>
  resolveTurnRunner?: () => Promise<Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>>
  resolveContextDiagnostics?: (args: {
    threadId: string
    cwd: string
    mode: 'normal' | 'acceptEdits' | 'plan'
    modeExplicit: boolean
    includeExitPlanReminder: boolean
    nextTurnInjectedBlocks?: PromptBlock[]
    format: 'text' | 'json'
  }) => Promise<{ stdout: string; diagnostics: ContextDiagnosticsPayload }>
  emitNotification?: (message: { jsonrpc: '2.0'; method: string; params?: unknown }) => void
  serverInstanceId?: string
  limits?: {
    maxRequestBytes: number
    maxEventBytes: number
    maxPendingInputsPerThread: number
    defaultInputTtlMs: number
    maxInFlightTurnsPerThread: number
  }
}

export class AppServer {
  private readonly info: AppServerInfo
  private readonly threadStore: Pick<
    ThreadStore,
    'startThread' | 'resumeThread' | 'listThreads' | 'readThread' | 'listThreadMessages'
  > &
    Partial<Pick<ThreadStore, 'renameThread' | 'archiveThread' | 'unarchiveThread' | 'hideThreadGroup'>>
  private turnRunner: Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'> | null
  private readonly resolveTurnRunner?: () => Promise<Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>>
  private readonly resolveContextDiagnostics?: AppServerOptions['resolveContextDiagnostics']
  private readonly emitNotification?: (message: { jsonrpc: '2.0'; method: string; params?: unknown }) => void
  private readonly serverInstanceId: string
  private readonly limits: {
    maxRequestBytes: number
    maxEventBytes: number
    maxPendingInputsPerThread: number
    defaultInputTtlMs: number
    maxInFlightTurnsPerThread: number
  }
  private readonly staleInputIds = new Set<string>()
  private readonly staleInputIdsByToolUseId = new Map<string, string>()
  private readonly replayByThreadId = new Map<string, ReplayEntry[]>()
  private readonly replayTrimmedBeforeByThreadId = new Map<string, number>()
  private readonly runtimeStateByThreadId = new Map<string, ThreadRuntimeState>()
  private readonly transcriptProjectionByThreadId = new Map<string, TranscriptProjectionState>()
  private readonly canonicalProtocolAnomalyCountByThreadId = new Map<string, number>()
  private readonly latestCompactBoundaryByThreadId = new Map<string, CompactBoundaryMeta | null>()
  private readonly liveCompactBoundaryByThreadId = new Map<
    string,
    { turnId: string; boundary: CompactBoundaryMeta; previousBoundary?: CompactBoundaryMeta | null }
  >()
  private readonly pendingExitPlanReminderByThreadId = new Map<string, true>()
  private readonly pendingInjectedBlocksByThreadId = new Map<string, PromptBlock[]>()
  private readonly pendingSessionMemoryRestoreByThreadId = new Map<string, SessionMemoryRestoreSummary | null>()
  private readonly maxReplayEventsPerThread = DEFAULT_MAX_REPLAY_EVENTS_PER_THREAD
  private replaySeq = 0

  private state: AppServerState = {
    initializeCompleted: false,
    initializedNotified: false,
  }

  constructor(args: AppServerOptions) {
    this.info = args.info
    this.threadStore = args.threadStore ?? new ThreadStore()
    this.turnRunner = args.turnRunner ?? null
    this.resolveTurnRunner = args.resolveTurnRunner
    this.resolveContextDiagnostics = args.resolveContextDiagnostics
    this.emitNotification = args.emitNotification
    this.serverInstanceId = args.serverInstanceId ?? randomUUID()
    // initialize.result.limits is sourced from runAppServer() wiring (index.ts):
    // transport limits + input lifecycle limits + in-flight turn policy.
    this.limits = args.limits ?? {
      maxRequestBytes: 1024 * 1024,
      maxEventBytes: 1024 * 1024,
      maxPendingInputsPerThread: DEFAULT_MAX_PENDING_INPUTS_PER_THREAD,
      defaultInputTtlMs: DEFAULT_INPUT_TTL_MS,
      maxInFlightTurnsPerThread: 1,
    }
  }

  getState(): AppServerState {
    return { ...this.state }
  }

  async handleMessage(msg: ParsedRpcMessage): Promise<Array<JsonRpcSuccessResponse | JsonRpcErrorResponse>> {
    if (msg.kind === 'invalid') {
      return [
        makeErrorResponse(msg.id, {
          code: JSON_RPC_ERRORS.INVALID_REQUEST,
          message: msg.message,
        }),
      ]
    }

    if (msg.kind === 'notification') {
      if (msg.notification.method === 'initialized' && this.state.initializeCompleted) {
        this.state.initializedNotified = true
      }
      return []
    }

    const req = msg.request

    if (req.method === 'initialize') {
      try {
        parseInitializeParams(req.params)
      } catch (err) {
        return [
          makeErrorResponse(req.id, {
            code: JSON_RPC_ERRORS.INVALID_PARAMS,
            message: 'Invalid params',
          }),
        ]
      }

      this.state.initializeCompleted = true
      return [
        makeSuccessResponse(req.id, {
          serverInfo: this.info,
          protocolVersion: APP_SERVER_PROTOCOL_VERSION,
          serverInstanceId: this.serverInstanceId,
          limits: this.limits,
        }),
      ]
    }

    if (!this.state.initializeCompleted) {
      return [
        makeErrorResponse(req.id, {
          code: JSON_RPC_ERRORS.NOT_INITIALIZED,
          message: 'Not initialized',
        }),
      ]
    }

    if (req.method === 'thread/start') {
      try {
        const params = parseThreadStartParams(req.params)
        const thread = await this.threadStore.startThread(params)
        return [makeSuccessResponse(req.id, { thread })]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'thread/resume') {
      try {
        const params = parseThreadByIdParams(req.params)
        const result: ThreadResumeResult = await this.threadStore.resumeThread(params.threadId)
        this.setPendingInjectedBlocks(params.threadId, result.nextTurnInjectedBlocks)
        this.setPendingSessionMemoryRestore(params.threadId, result.pendingSessionMemoryRestore)
        this.rememberLatestCompactBoundary(params.threadId, result.latestCompactBoundary)
        for (const input of result.staleInputs) {
          this.staleInputIds.add(input.inputId)
          this.staleInputIdsByToolUseId.set(input.toolUseId, input.inputId)
        }
        return [
          makeSuccessResponse(req.id, {
            thread: result.thread,
            staleInputs: result.staleInputs,
            latestCompactBoundary: result.latestCompactBoundary,
            pendingSessionMemoryRestore: result.pendingSessionMemoryRestore ?? null,
          }),
        ]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'thread/list') {
      try {
        const params = parseThreadListParams(req.params)
        const result: ThreadListResult = await this.threadStore.listThreads(params)
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'thread/read') {
      try {
        const params = parseThreadByIdParams(req.params)
        const result: ThreadReadResult = await this.threadStore.readThread(params.threadId)
        this.rememberLatestCompactBoundary(params.threadId, result.latestCompactBoundary)
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'thread/messages') {
      try {
        const params = parseThreadMessagesParams(req.params)
        const result: ThreadMessagesResult = await this.threadStore.listThreadMessages(params)
        this.rememberLatestCompactBoundary(params.threadId, result.latestCompactBoundary)
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'thread/rename') {
      if (!this.threadStore.renameThread) {
        return [
          makeErrorResponse(req.id, {
            code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
            message: `Method not found: ${req.method}`,
          }),
        ]
      }
      try {
        const params = parseThreadRenameParams(req.params)
        const result = await this.threadStore.renameThread(params)
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'thread/group/hide') {
      if (!this.threadStore.hideThreadGroup) {
        return [
          makeErrorResponse(req.id, {
            code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
            message: `Method not found: ${req.method}`,
          }),
        ]
      }
      try {
        const params = parseThreadGroupHideParams(req.params)
        const result = await this.threadStore.hideThreadGroup(params.cwd)
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'thread/archive') {
      if (!this.threadStore.archiveThread) {
        return [
          makeErrorResponse(req.id, {
            code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
            message: `Method not found: ${req.method}`,
          }),
        ]
      }
      try {
        const params = parseThreadArchiveParams(req.params)
        const result = await this.threadStore.archiveThread(params.threadId)
        this.emitServerNotification('thread/archived', {
          threadId: params.threadId,
          opId: params.opId ?? null,
          archivedAt: result.thread.archivedAt ?? new Date().toISOString(),
        })
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'thread/unarchive') {
      if (!this.threadStore.unarchiveThread) {
        return [
          makeErrorResponse(req.id, {
            code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
            message: `Method not found: ${req.method}`,
          }),
        ]
      }
      try {
        const params = parseThreadByIdParams(req.params)
        const result = await this.threadStore.unarchiveThread(params.threadId)
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'thread/replay') {
      try {
        const params = parseThreadReplayParams(req.params)
        const result = await this.getThreadReplay(params)
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'turn/start') {
      try {
        const params = parseTurnStartParams(req.params)
        const runner = await this.getTurnRunner()
        const exitPlanReminder = this.resolveExitPlanReminder({
          threadId: params.threadId,
          requestedMode: params.mode,
        })
        const nextTurnInjectedBlocks = this.getPendingInjectedBlocks(params.threadId)
        const result = await runner.startTurn({
          ...params,
          ...(exitPlanReminder.include ? { includeExitPlanReminder: true } : {}),
          ...(nextTurnInjectedBlocks.length > 0 ? { pendingInjectedBlocks: nextTurnInjectedBlocks } : {}),
          ...(nextTurnInjectedBlocks.length > 0
            ? {
                onPendingInjectedBlocksConsumed: () => this.consumePendingInjectedBlocksForDispatch(params.threadId),
              }
            : {}),
        })
        if (exitPlanReminder.consumePendingOnSuccess) {
          this.pendingExitPlanReminderByThreadId.delete(params.threadId)
        }
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'command/dispatch') {
      try {
        const params = parseCommandDispatchParams(req.params)
        const commandRouting = resolveCommandRouting(params.command)
        if (!commandRouting.shouldUseCommandDispatch) {
          return [
            makeErrorResponse(req.id, {
              code: JSON_RPC_ERRORS.INVALID_PARAMS,
              message: `Unsupported params.command for command/dispatch: ${params.command}`,
            }),
          ]
        }

        if (commandRouting.commandName === '/todos' || commandRouting.commandName === '/context') {
          const thread = await this.threadStore.readThread(params.threadId)
          const dispatchCwd = params.cwd ? path.resolve(params.cwd) : thread.thread.cwd
          const rawParams = req.params && typeof req.params === 'object' && !Array.isArray(req.params) ? req.params : null
          const modeExplicit = Boolean(
            rawParams &&
              Object.prototype.hasOwnProperty.call(rawParams, 'mode') &&
              params.mode !== undefined,
          )

          if (commandRouting.commandName === '/context') {
            const outputFormat = resolveContextDiagnosticsOutputFormat(commandRouting.commandArgs ?? '')
            if (!outputFormat) {
              return [
                makeSuccessResponse(req.id, {
                  command: params.command,
                  dispatched: true,
                  local: {
                    stdout: 'Usage: /context [--json]',
                  },
                }),
              ]
            }
            if (!this.resolveContextDiagnostics) {
              throw new Error(`Failed to dispatch local command: ${params.command}`)
            }
            const effect = await this.resolveContextDiagnostics({
              threadId: params.threadId,
              cwd: dispatchCwd,
              mode: params.mode ?? 'normal',
              modeExplicit,
              includeExitPlanReminder: this.resolveExitPlanReminder({
                threadId: params.threadId,
                requestedMode: params.mode,
              }).include,
              nextTurnInjectedBlocks: this.getPendingInjectedBlocks(params.threadId),
              format: outputFormat,
            })
            return [
                makeSuccessResponse(req.id, {
                  command: params.command,
                  dispatched: true,
                  local: {
                    stdout: stripAnsiSgr(effect.stdout),
                    diagnostics: effect.diagnostics,
                  },
                }),
              ]
            }

          const slashRegistry = createSlashCommandRegistry({ cwd: dispatchCwd })
          const normalizedDispatchCommand = commandRouting.commandArgs
            ? `${commandRouting.commandName} ${commandRouting.commandArgs}`
            : commandRouting.commandName
          const effect = slashRegistry.dispatch(normalizedDispatchCommand)
          if (!effect || effect.kind !== 'local') throw new Error(`Failed to dispatch local command: ${params.command}`)
          return [
            makeSuccessResponse(req.id, {
              command: params.command,
              dispatched: true,
              local: {
                stdout: stripAnsiSgr(effect.stdout),
              },
            }),
          ]
        }

        const runner = await this.getTurnRunner()
        const exitPlanReminder = this.resolveExitPlanReminder({
          threadId: params.threadId,
          requestedMode: params.mode,
        })
        const nextTurnInjectedBlocks = this.getPendingInjectedBlocks(params.threadId)
        const result = await runner.startTurn({
          threadId: params.threadId,
          input: { text: params.command },
          ...(params.mode ? { mode: params.mode } : {}),
          ...(params.cwd ? { cwd: params.cwd } : {}),
          ...(exitPlanReminder.include ? { includeExitPlanReminder: true } : {}),
          ...(nextTurnInjectedBlocks.length > 0 ? { pendingInjectedBlocks: nextTurnInjectedBlocks } : {}),
          ...(nextTurnInjectedBlocks.length > 0
            ? {
                onPendingInjectedBlocksConsumed: () => this.consumePendingInjectedBlocksForDispatch(params.threadId),
              }
            : {}),
        })
        if (exitPlanReminder.consumePendingOnSuccess) {
          this.pendingExitPlanReminderByThreadId.delete(params.threadId)
        }
        return [makeSuccessResponse(req.id, { ...result, command: params.command, dispatched: true })]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'turn/interrupt') {
      try {
        const params = parseTurnInterruptParams(req.params)
        const runner = await this.getTurnRunner()
        const result = await runner.interruptTurn(params)
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'turn/input/submit') {
      try {
        const params = parseTurnInputSubmitParams(req.params)
        const staleInputId =
          this.staleInputIds.has(params.inputId)
            ? params.inputId
            : params.toolUseId
              ? this.staleInputIdsByToolUseId.get(params.toolUseId) ?? null
              : null
        if (staleInputId) {
          return [
            makeErrorResponse(req.id, {
              code: JSON_RPC_ERRORS.INVALID_PARAMS,
              message: 'INPUT_EXPIRED',
              data: {
                kind: 'INPUT_EXPIRED',
                recoverable: false,
                retryable: false,
                inputId: staleInputId,
              },
            }),
          ]
        }
        const runner = await this.getTurnRunner()
        const result = await runner.submitInput(params)
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    return [
      makeErrorResponse(req.id, {
        code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        message: `Method not found: ${req.method}`,
      }),
    ]
  }

  private toRpcError(err: unknown): { code: number; message: string } {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (
      message.startsWith('Invalid params') ||
      message.startsWith('Thread not found') ||
      message.startsWith('Turn already running') ||
      message.startsWith('Turn not running')
    ) {
      return { code: JSON_RPC_ERRORS.INVALID_PARAMS, message }
    }
    return { code: JSON_RPC_ERRORS.INTERNAL_ERROR, message }
  }

  private async getTurnRunner(): Promise<Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>> {
    if (this.turnRunner) return this.turnRunner
    if (!this.resolveTurnRunner) {
      throw new Error('Turn runner is not configured')
    }
    const resolved = await this.resolveTurnRunner()
    this.turnRunner = resolved
    return resolved
  }

  private resolveExitPlanReminder(args: {
    threadId: string
    requestedMode?: ThreadRuntimeState['mode']
  }): { include: boolean; consumePendingOnSuccess: boolean } {
    const nextMode = normalizeReplMode(args.requestedMode, 'normal')
    const hasPending = nextMode !== 'plan' && this.pendingExitPlanReminderByThreadId.get(args.threadId) === true
    if (hasPending) {
      return { include: true, consumePendingOnSuccess: true }
    }
    const previousMode = this.runtimeStateByThreadId.get(args.threadId)?.mode ?? 'normal'
    return {
      include: shouldInjectExitPlanReminder({ current: previousMode, next: nextMode }),
      consumePendingOnSuccess: false,
    }
  }

  private getPendingInjectedBlocks(threadId: string): PromptBlock[] {
    return this.pendingInjectedBlocksByThreadId.get(threadId) ?? []
  }

  private setPendingInjectedBlocks(threadId: string, blocks?: PromptBlock[]): void {
    if (Array.isArray(blocks) && blocks.length > 0) {
      this.pendingInjectedBlocksByThreadId.set(threadId, blocks)
      return
    }
    this.pendingInjectedBlocksByThreadId.delete(threadId)
  }

  private clearPendingInjectedBlocks(threadId: string): void {
    this.pendingInjectedBlocksByThreadId.delete(threadId)
  }

  private getPendingSessionMemoryRestore(threadId: string): SessionMemoryRestoreSummary | null {
    return this.pendingSessionMemoryRestoreByThreadId.get(threadId) ?? null
  }

  private setPendingSessionMemoryRestore(threadId: string, summary?: SessionMemoryRestoreSummary | null): void {
    if (summary) {
      this.pendingSessionMemoryRestoreByThreadId.set(threadId, summary)
      return
    }
    this.pendingSessionMemoryRestoreByThreadId.delete(threadId)
  }

  private clearPendingSessionMemoryRestore(threadId: string): void {
    this.pendingSessionMemoryRestoreByThreadId.delete(threadId)
  }

  private consumePendingInjectedBlocksForDispatch(threadId: string): void {
    this.clearPendingInjectedBlocks(threadId)
    this.clearPendingSessionMemoryRestore(threadId)
  }

  private rememberLatestCompactBoundary(threadId: string, boundary?: CompactBoundaryMeta | null): void {
    this.latestCompactBoundaryByThreadId.set(threadId, boundary ?? null)
  }

  createTurnNotificationEmitter(): (method: string, params?: unknown) => void {
    return (method, params) => {
      this.emitServerNotification(method, params)
    }
  }

  private emitServerNotification(method: string, params?: unknown): void {
    const replayWrapped = this.captureReplayAndRuntimeState(method, params)
    this.emitNotification?.({
      jsonrpc: '2.0',
      method,
      ...(replayWrapped === undefined ? {} : { params: replayWrapped }),
    })
  }

  private captureReplayAndRuntimeState(method: string, params?: unknown): Record<string, unknown> | undefined {
    const paramsObj = params && typeof params === 'object' ? (params as Record<string, unknown>) : null
    const threadId = extractThreadIdFromNotificationParams(paramsObj)
    if (!threadId) return paramsObj ?? undefined

    const replaySeq = this.replaySeq + 1
    this.replaySeq = replaySeq
    const wrapped: Record<string, unknown> = { replaySeq }
    Object.assign(wrapped, paramsObj)

    const currentEntries = this.replayByThreadId.get(threadId) ?? []
    currentEntries.push({
      replaySeq,
      method,
      params: wrapped,
    })
    if (currentEntries.length > this.maxReplayEventsPerThread) {
      const trimCount = currentEntries.length - this.maxReplayEventsPerThread
      const trimmed = currentEntries.splice(0, trimCount)
      const trimmedBefore = trimmed[trimmed.length - 1]!.replaySeq
      const previousTrimmed = this.replayTrimmedBeforeByThreadId.get(threadId) ?? 0
      this.replayTrimmedBeforeByThreadId.set(threadId, Math.max(previousTrimmed, trimmedBefore))
    }
    this.replayByThreadId.set(threadId, currentEntries)

    const currentState = this.runtimeStateByThreadId.get(threadId)
    const baseState =
      currentState ??
      createInitialThreadRuntimeState({
        threadId,
        replaySeq,
        method,
        ts: wrapped.ts,
      })
    const nextState = reduceThreadRuntimeState(baseState, {
      method,
      params: wrapped,
      replaySeq,
    })
    this.runtimeStateByThreadId.set(threadId, nextState)

    const canonicalEvents = mapTurnNotificationToCanonicalEvents(
      { method, params: wrapped },
      {
        fallbackThreadId: threadId,
        source: 'engine',
        requireEnvelope: true,
        onInvalidEnvelope: () => {
          const previous = this.canonicalProtocolAnomalyCountByThreadId.get(threadId) ?? 0
          this.canonicalProtocolAnomalyCountByThreadId.set(threadId, previous + 1)
        },
      },
    )
    if (canonicalEvents.length > 0) {
      const baseProjection =
        this.transcriptProjectionByThreadId.get(threadId) ?? createInitialTranscriptProjectionState({ threadId })
      const nextProjection = canonicalEvents.reduce(
        (projection, event) => reduceTranscriptProjection(projection, event),
        baseProjection,
      )
      this.transcriptProjectionByThreadId.set(threadId, nextProjection)
    }

    if (method === 'turn/modeChanged') {
      if (shouldInjectExitPlanReminder({ current: baseState.mode, next: nextState.mode })) {
        this.pendingExitPlanReminderByThreadId.set(threadId, true)
      } else if (nextState.mode === 'plan') {
        this.pendingExitPlanReminderByThreadId.delete(threadId)
      }
    } else if (method === 'turn/started' && nextState.mode === 'plan') {
      this.pendingExitPlanReminderByThreadId.delete(threadId)
    }

    const turnId = readTurnIdFromNotificationParams(paramsObj)
    const latestCompactBoundaryFromEvent = readCompactBoundaryFromTurnEvent(paramsObj)
    if (latestCompactBoundaryFromEvent) {
      const existingPending = turnId ? this.liveCompactBoundaryByThreadId.get(threadId) : null
      const previousBoundary =
        existingPending?.turnId === turnId
          ? existingPending.previousBoundary
          : this.latestCompactBoundaryByThreadId.has(threadId)
            ? (this.latestCompactBoundaryByThreadId.get(threadId) ?? null)
            : undefined
      this.rememberLatestCompactBoundary(threadId, latestCompactBoundaryFromEvent)
      if (turnId) {
        this.liveCompactBoundaryByThreadId.set(threadId, {
          turnId,
          boundary: latestCompactBoundaryFromEvent,
          ...(previousBoundary !== undefined ? { previousBoundary } : {}),
        })
      }
    } else if (method === 'turn/completed' && turnId) {
      const pending = this.liveCompactBoundaryByThreadId.get(threadId)
      if (pending?.turnId === turnId) {
        this.rememberLatestCompactBoundary(threadId, pending.boundary)
        this.liveCompactBoundaryByThreadId.delete(threadId)
      }
    } else if (method === 'turn/failed' && turnId) {
      const pending = this.liveCompactBoundaryByThreadId.get(threadId)
      if (pending?.turnId === turnId) {
        this.liveCompactBoundaryByThreadId.delete(threadId)
        if (pending.previousBoundary === undefined) {
          this.latestCompactBoundaryByThreadId.delete(threadId)
        } else {
          this.rememberLatestCompactBoundary(threadId, pending.previousBoundary)
        }
      }
    }

    return wrapped
  }

  private async getThreadReplay(args: { threadId: string; after?: number; limit: number }): Promise<{
    data: Array<{ replaySeq: number; method: string; params?: Record<string, unknown> }>
    nextCursor: number
    latestCursor: number
    hasGap: boolean
    state: ReplayStateSnapshot | null
    latestCompactBoundary: CompactBoundaryMeta | null
    pendingSessionMemoryRestore: SessionMemoryRestoreSummary | null
  }> {
    const entries = this.replayByThreadId.get(args.threadId) ?? []
    const latestCursor = entries.length > 0 ? entries[entries.length - 1]!.replaySeq : 0
    const trimmedBefore = this.replayTrimmedBeforeByThreadId.get(args.threadId) ?? 0
    const hasGap = args.after != null && args.after < trimmedBefore
    const state = this.runtimeStateByThreadId.get(args.threadId) ?? null
    const projection = this.transcriptProjectionByThreadId.get(args.threadId) ?? null
    const canonicalProtocolAnomalyCount = this.canonicalProtocolAnomalyCountByThreadId.get(args.threadId) ?? 0
    const fallbackSnapshotState: ThreadRuntimeState | null =
      !state && hasGap && projection
        ? {
            threadId: args.threadId,
            mode: 'normal',
            activeTurnId: null,
            lastTurnId: null,
            lastTurnStatus: null,
            pendingInputs: {},
            toolNameByUseId: { ...projection.toolNameByUseId },
            updatedAt: new Date(0).toISOString(),
            lastNotificationMethod: null,
            lastReplaySeq: latestCursor,
          }
        : null
    const stateForSnapshot = state ?? fallbackSnapshotState
    const shouldIncludeProjectionSnapshot = Boolean(projection) && (hasGap || args.after == null)
    const stateSnapshot = buildReplayStateSnapshot({
      stateForSnapshot,
      projection,
      includeProjectionSnapshot: shouldIncludeProjectionSnapshot,
      canonicalProtocolAnomalyCount,
    })
    const pendingLiveCompactBoundary = this.liveCompactBoundaryByThreadId.get(args.threadId) ?? null
    const latestCompactBoundary = await this.resolveLatestCompactBoundaryForReplay(args.threadId)
    const stableLatestCompactBoundary = pendingLiveCompactBoundary
      ? (pendingLiveCompactBoundary.previousBoundary ?? null)
      : latestCompactBoundary

    if (entries.length === 0) {
      return {
        data: [],
        nextCursor: 0,
        latestCursor: 0,
        hasGap,
        state: stateSnapshot,
        latestCompactBoundary: stableLatestCompactBoundary,
        pendingSessionMemoryRestore: this.getPendingSessionMemoryRestore(args.threadId),
      }
    }

    if (args.after == null) {
      return {
        data: [],
        nextCursor: latestCursor,
        latestCursor,
        hasGap: false,
        state: stateSnapshot,
        latestCompactBoundary: stableLatestCompactBoundary,
        pendingSessionMemoryRestore: this.getPendingSessionMemoryRestore(args.threadId),
      }
    }

    let startIndex = entries.findIndex((entry) => entry.replaySeq > args.after!)
    if (startIndex < 0) startIndex = entries.length
    if (hasGap) startIndex = 0

    const page = entries.slice(startIndex, startIndex + args.limit)
    const nextCursor = page.length > 0 ? page[page.length - 1]!.replaySeq : Math.min(args.after, latestCursor)
    const replayCoversTail = nextCursor === latestCursor
    const liveCompactBoundaryFromPage = replayCoversTail ? readCompactBoundaryFromReplayEntries(page) : null
    const pendingLiveCompactBoundaryFromTail = replayCoversTail ? pendingLiveCompactBoundary?.boundary : null

    return {
      data: page.map((entry) => ({
        replaySeq: entry.replaySeq,
        method: entry.method,
        params: entry.params,
      })),
      nextCursor,
      latestCursor,
      hasGap,
      state: stateSnapshot,
      latestCompactBoundary: replayCoversTail
        ? (liveCompactBoundaryFromPage ?? pendingLiveCompactBoundaryFromTail ?? latestCompactBoundary)
        : hasGap
          ? latestCompactBoundary
          : stableLatestCompactBoundary,
      pendingSessionMemoryRestore: this.getPendingSessionMemoryRestore(args.threadId),
    }
  }

  private async resolveLatestCompactBoundaryForReplay(threadId: string): Promise<CompactBoundaryMeta | null> {
    if (this.latestCompactBoundaryByThreadId.has(threadId)) {
      return this.latestCompactBoundaryByThreadId.get(threadId) ?? null
    }
    try {
      const thread = await this.threadStore.readThread(threadId)
      const latestCompactBoundary = thread.latestCompactBoundary ?? null
      this.rememberLatestCompactBoundary(threadId, latestCompactBoundary)
      return latestCompactBoundary
    } catch {
      this.rememberLatestCompactBoundary(threadId, null)
      return null
    }
  }
}

function stripAnsiSgr(text: string): string {
  return String(text ?? '').replace(ANSI_SGR_RE, '')
}

function readCompactBoundaryFromTurnEvent(params: Record<string, unknown> | null): CompactBoundaryMeta | null {
  if (!params) return null
  const event = params.event
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'compact_boundary') return null
  const boundary = eventRecord.boundary
  if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary)) return null
  if ((boundary as Record<string, unknown>).schemaVersion !== 1) return null
  return boundary as CompactBoundaryMeta
}

function readCompactBoundaryFromReplayEntries(entries: ReplayEntry[]): CompactBoundaryMeta | null {
  const failedTurnIds = new Set<string>()
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry) continue
    const turnId = readTurnIdFromNotificationParams(entry.params ?? null)
    if (entry.method === 'turn/failed' && turnId) {
      failedTurnIds.add(turnId)
      continue
    }
    const boundary = readCompactBoundaryFromTurnEvent(entry.params ?? null)
    if (boundary && turnId && failedTurnIds.has(turnId)) continue
    if (boundary) return boundary
  }
  return null
}

function readTurnIdFromNotificationParams(params: Record<string, unknown> | null): string | null {
  if (!params) return null
  if (typeof params.turnId === 'string' && params.turnId.trim()) return params.turnId
  const turn = params.turn
  if (!turn || typeof turn !== 'object' || Array.isArray(turn)) return null
  const turnId = (turn as Record<string, unknown>).id
  return typeof turnId === 'string' && turnId.trim() ? turnId : null
}
