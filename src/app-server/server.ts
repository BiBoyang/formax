import { randomUUID } from 'node:crypto'
import path from 'node:path'
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
import { resolveCommandRouting } from '../features/semantics/core/commandRouting.js'
import { normalizeReplMode, shouldInjectExitPlanReminder } from '../features/semantics/core/replModeTransition.js'
import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
  type TranscriptProjectionState,
} from '../features/semantics/projection/transcriptProjection.js'
import { toCanonicalEventsFromTurnNotification } from '../features/semantics/adapters/turnNotificationCanonicalAdapter.js'
import { buildReplayStateSnapshot, type ReplayStateSnapshot } from './replayStateSnapshot.js'

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
    Partial<Pick<ThreadStore, 'renameThread' | 'archiveThread' | 'unarchiveThread'>>
  turnRunner?: Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>
  resolveTurnRunner?: () => Promise<Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>>
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
    Partial<Pick<ThreadStore, 'renameThread' | 'archiveThread' | 'unarchiveThread'>>
  private turnRunner: Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'> | null
  private readonly resolveTurnRunner?: () => Promise<Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>>
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
  private readonly pendingExitPlanReminderByThreadId = new Map<string, true>()
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
        const message = err instanceof Error ? err.message : 'Invalid params'
        return [
          makeErrorResponse(req.id, {
            code: JSON_RPC_ERRORS.INVALID_PARAMS,
            message,
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
        for (const input of result.staleInputs) {
          this.staleInputIds.add(input.inputId)
          this.staleInputIdsByToolUseId.set(input.toolUseId, input.inputId)
        }
        return [makeSuccessResponse(req.id, result)]
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
        return [makeSuccessResponse(req.id, result)]
      } catch (err) {
        return [makeErrorResponse(req.id, this.toRpcError(err))]
      }
    }

    if (req.method === 'thread/messages') {
      try {
        const params = parseThreadMessagesParams(req.params)
        const result: ThreadMessagesResult = await this.threadStore.listThreadMessages(params)
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
        const result = this.getThreadReplay(params)
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
        const result = await runner.startTurn({
          ...params,
          ...(exitPlanReminder.include ? { includeExitPlanReminder: true } : {}),
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

        if (commandRouting.commandName === '/todos') {
          const thread = await this.threadStore.readThread(params.threadId)
          const dispatchCwd = params.cwd ? path.resolve(params.cwd) : thread.thread.cwd
          const slashRegistry = createSlashCommandRegistry({ cwd: dispatchCwd })
          const normalizedDispatchCommand = commandRouting.commandArgs
            ? `${commandRouting.commandName} ${commandRouting.commandArgs}`
            : commandRouting.commandName
          const effect = slashRegistry.dispatch(normalizedDispatchCommand)
          if (!effect || effect.kind !== 'local') {
            return [
              makeErrorResponse(req.id, {
                code: JSON_RPC_ERRORS.INTERNAL_ERROR,
                message: `Failed to dispatch local command: ${params.command}`,
              }),
            ]
          }
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
        const result = await runner.startTurn({
          threadId: params.threadId,
          input: { text: params.command },
          ...(params.mode ? { mode: params.mode } : {}),
          ...(params.cwd ? { cwd: params.cwd } : {}),
          ...(exitPlanReminder.include ? { includeExitPlanReminder: true } : {}),
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
    const wrapped: Record<string, unknown> = {
      ...(paramsObj ?? {}),
      replaySeq,
    }

    const currentEntries = this.replayByThreadId.get(threadId) ?? []
    currentEntries.push({
      replaySeq,
      method,
      params: wrapped,
    })
    if (currentEntries.length > this.maxReplayEventsPerThread) {
      const trimCount = currentEntries.length - this.maxReplayEventsPerThread
      const trimmed = currentEntries.splice(0, trimCount)
      const trimmedBefore = trimmed[trimmed.length - 1]?.replaySeq
      if (typeof trimmedBefore === 'number') {
        const previousTrimmed = this.replayTrimmedBeforeByThreadId.get(threadId) ?? 0
        if (trimmedBefore > previousTrimmed) {
          this.replayTrimmedBeforeByThreadId.set(threadId, trimmedBefore)
        }
      }
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

    const canonicalEvents = toCanonicalEventsFromTurnNotification(
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

    return wrapped
  }

  private getThreadReplay(args: { threadId: string; after?: number; limit: number }): {
    data: Array<{ replaySeq: number; method: string; params?: Record<string, unknown> }>
    nextCursor: number
    latestCursor: number
    hasGap: boolean
    state: ReplayStateSnapshot | null
  } {
    const entries = this.replayByThreadId.get(args.threadId) ?? []
    const latestCursor = entries.length > 0 ? entries[entries.length - 1]!.replaySeq : 0
    const trimmedBefore = this.replayTrimmedBeforeByThreadId.get(args.threadId) ?? 0
    const hasGap = args.after != null && args.after < trimmedBefore
    const state = this.runtimeStateByThreadId.get(args.threadId) ?? null
    const projection = this.transcriptProjectionByThreadId.get(args.threadId) ?? null
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
    })

    if (entries.length === 0) {
      return {
        data: [],
        nextCursor: 0,
        latestCursor: 0,
        hasGap,
        state: stateSnapshot,
      }
    }

    if (args.after == null) {
      return {
        data: [],
        nextCursor: latestCursor,
        latestCursor,
        hasGap: false,
        state: stateSnapshot,
      }
    }

    let startIndex = entries.findIndex((entry) => entry.replaySeq > args.after!)
    if (startIndex < 0) startIndex = entries.length
    if (hasGap) startIndex = 0

    const page = entries.slice(startIndex, startIndex + args.limit)
    const nextCursor = page.length > 0 ? page[page.length - 1]!.replaySeq : Math.min(args.after, latestCursor)

    return {
      data: page.map((entry) => ({
        replaySeq: entry.replaySeq,
        method: entry.method,
        ...(entry.params ? { params: entry.params } : {}),
      })),
      nextCursor,
      latestCursor,
      hasGap,
      state: stateSnapshot,
    }
  }
}

function stripAnsiSgr(text: string): string {
  return String(text ?? '').replace(ANSI_SGR_RE, '')
}
