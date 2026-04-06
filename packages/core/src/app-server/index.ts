import pkg from '../../package.json'
import { buildContextDiagnosticsPayload, formatContextDiagnosticsReport } from '../chat/context/contextDiagnostics.js'
import { findSessionFileBySessionId, readSessionFile } from '../features/repl/sessionSave/index.js'
import { buildTurnInput } from '../features/semantics/adapters/turnInputBuilder.js'
import { createRuntime } from '../runtime/createRuntime.js'
import { resolveDeferredToolExposureForTurn } from '../tools/runtime/deferredToolExposureResolver.js'
import { AppServer } from './server.js'
import {
  classifyRpcMessage,
  JSON_RPC_ERRORS,
  makeErrorResponse,
  parseJsonLine,
  type ParsedRpcMessage,
  type JsonRpcId,
} from './jsonrpc.js'
import { ThreadStore } from './threadStore.js'
import { DEFAULT_INPUT_TTL_MS, DEFAULT_MAX_PENDING_INPUTS_PER_THREAD, TurnRunner } from './turnRunner.js'
import { createStdioJsonlTransport, StdioPayloadTooLargeError } from './transport/stdio.js'

export const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024
export const DEFAULT_MAX_EVENT_BYTES = 1024 * 1024
export const DEFAULT_APP_SERVER_QUEUE_CAPACITY = 128
const OVERLOADED_ERROR_MESSAGE = 'Server overloaded; retry later.'
type OutboundQueueItem = {
  payload: unknown
  swallowSendErrors: boolean
}

function normalizePositiveLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  return rounded >= 1 ? rounded : fallback
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(String(value))
}

class BoundedAsyncQueue<T> {
  private readonly capacity: number
  private readonly items: T[] = []
  private readonly pullWaiters: Array<(value: T | undefined) => void> = []
  private readonly pushWaiters: Array<{ value: T; resolve: (enqueued: boolean) => void }> = []
  private closed = false

  constructor(capacity: number) {
    this.capacity = normalizePositiveLimit(capacity, DEFAULT_APP_SERVER_QUEUE_CAPACITY)
  }

  tryPush(value: T): boolean {
    if (this.closed) return false
    const pullWaiter = this.pullWaiters.shift()
    if (pullWaiter) {
      pullWaiter(value)
      return true
    }
    if (this.items.length >= this.capacity) return false
    this.items.push(value)
    return true
  }

  async push(value: T): Promise<boolean> {
    if (this.tryPush(value)) return true
    if (this.closed) return false
    return new Promise((resolve) => {
      this.pushWaiters.push({ value, resolve })
    })
  }

  async pop(): Promise<T | undefined> {
    if (this.items.length > 0) {
      const value = this.items.shift()!
      this.flushPushWaiters()
      return value
    }
    if (this.closed) return undefined
    return new Promise((resolve) => {
      this.pullWaiters.push(resolve)
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.pullWaiters.length > 0) {
      const waiter = this.pullWaiters.shift()!
      waiter(undefined)
    }
    while (this.pushWaiters.length > 0) {
      const waiter = this.pushWaiters.shift()!
      waiter.resolve(false)
    }
  }

  private flushPushWaiters(): void {
    while (!this.closed && this.pushWaiters.length > 0) {
      const pullWaiter = this.pullWaiters.shift()
      const waiter = this.pushWaiters.shift()!
      if (pullWaiter) {
        pullWaiter(waiter.value)
        waiter.resolve(true)
        continue
      }
      if (this.items.length >= this.capacity) {
        this.pushWaiters.unshift(waiter)
        return
      }
      this.items.push(waiter.value)
      waiter.resolve(true)
    }
  }
}

function makePayloadTooLargeError(args: {
  id: JsonRpcId
  direction: 'request' | 'event'
  maxBytes: number
  actualBytes: number
}) {
  return makeErrorResponse(args.id, {
    code: JSON_RPC_ERRORS.PAYLOAD_TOO_LARGE,
    message: 'PAYLOAD_TOO_LARGE',
    data: {
      kind: 'PAYLOAD_TOO_LARGE',
      recoverable: true,
      retryable: true,
      direction: args.direction,
      maxBytes: args.maxBytes,
      actualBytes: args.actualBytes,
    },
  })
}

function makeOverloadedError(id: JsonRpcId) {
  return makeErrorResponse(id, {
    code: JSON_RPC_ERRORS.OVERLOADED,
    message: OVERLOADED_ERROR_MESSAGE,
  })
}

export async function runAppServer(args?: {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
  threadStore?: Pick<ThreadStore, 'startThread' | 'resumeThread' | 'listThreads' | 'readThread' | 'listThreadMessages'> &
    Partial<Pick<ThreadStore, 'renameThread' | 'archiveThread' | 'unarchiveThread' | 'ensureThreadFile'>>
  turnRunner?: Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>
  maxRequestBytes?: number
  maxEventBytes?: number
  maxPendingInputsPerThread?: number
  defaultInputTtlMs?: number
  ingressQueueCapacity?: number
  outboundQueueCapacity?: number
}): Promise<void> {
  const cwd = args?.cwd ?? process.cwd()
  const env = args?.env ?? process.env
  const maxRequestBytes = normalizePositiveLimit(args?.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES)
  const maxEventBytes = normalizePositiveLimit(args?.maxEventBytes, DEFAULT_MAX_EVENT_BYTES)
  const ingressQueueCapacity = normalizePositiveLimit(args?.ingressQueueCapacity, DEFAULT_APP_SERVER_QUEUE_CAPACITY)
  const outboundQueueCapacity = normalizePositiveLimit(args?.outboundQueueCapacity, DEFAULT_APP_SERVER_QUEUE_CAPACITY)
  const maxPendingInputsPerThread = normalizePositiveLimit(
    args?.maxPendingInputsPerThread,
    DEFAULT_MAX_PENDING_INPUTS_PER_THREAD,
  )
  const defaultInputTtlMs = normalizePositiveLimit(args?.defaultInputTtlMs, DEFAULT_INPUT_TTL_MS)
  const transport = createStdioJsonlTransport({
    input: args?.input,
    output: args?.output,
    maxEventBytes,
  })
  const transportAbortController = new AbortController()

  const transportSendSafe = async (message: unknown): Promise<void> => {
    try {
      await transport.send(message)
    } catch (err) {
      if (err instanceof StdioPayloadTooLargeError) return
      throw err
    }
  }
  const threadStore =
    args?.threadStore ??
    new ThreadStore({
      cwd,
      env,
      platform: args?.platform,
      homedir: args?.homedir,
    })
  const ingressQueue = new BoundedAsyncQueue<ParsedRpcMessage>(ingressQueueCapacity)
  const outboundQueue = new BoundedAsyncQueue<OutboundQueueItem>(outboundQueueCapacity)

  const enqueueOutboundStrict = async (message: unknown): Promise<boolean> => {
    return outboundQueue.push({ payload: message, swallowSendErrors: false })
  }

  const tryEnqueueOutbound = (message: unknown, swallowSendErrors: boolean): boolean => {
    return outboundQueue.tryPush({ payload: message, swallowSendErrors })
  }

  const enqueueOverloadedError = async (id: JsonRpcId): Promise<void> => {
    await enqueueOutboundStrict(makeOverloadedError(id))
  }

  let lazyTurnRunner: Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'> | null = args?.turnRunner ?? null
  const server = new AppServer({
    info: {
      name: 'formax',
      version: String((pkg as any).version),
    },
    threadStore,
    turnRunner: lazyTurnRunner ?? undefined,
    resolveTurnRunner: async () => {
      if (lazyTurnRunner) return lazyTurnRunner
      const runtime = await createRuntime({ cwd, env })
      lazyTurnRunner = new TurnRunner({
        engine: runtime.engine,
        tools: runtime.tools,
        allowedSubagents: runtime.allowedSubagents,
        model: runtime.cfg.llm.model,
        thinkingEnabled: runtime.cfg.llm.thinkingMode,
        cwd,
        env,
        platform: args?.platform,
        homedir: args?.homedir,
        userInputManager: runtime.userInputManager,
        emitNotification: server.createTurnNotificationEmitter(),
        defaultInputTtlMs,
        maxPendingInputsPerThread,
        ensureThreadFilePath:
          typeof threadStore.ensureThreadFile === 'function'
            ? ({ threadId, cwd: threadCwd }) => threadStore.ensureThreadFile!({ threadId, cwd: threadCwd })
            : undefined,
      })
      return lazyTurnRunner
    },
    resolveContextDiagnostics: async ({ threadId, cwd: dispatchCwd, mode, includeExitPlanReminder, format }) => {
      const runtime = await createRuntime({ cwd: dispatchCwd, env })
      const sessionFilePath = await findSessionFileBySessionId({
        cwd: dispatchCwd,
        env,
        platform: args?.platform,
        homedir: args?.homedir,
        sessionId: threadId,
      })
      const replay = sessionFilePath ? await readSessionFile(sessionFilePath) : null
      const deferredToolExposureEnabled = runtime.runtimeFlags.deferredToolExposureEnabled === true
      const toolExposure = resolveDeferredToolExposureForTurn({
        cwd: dispatchCwd,
        tools: runtime.tools,
        deferredToolExposureEnabled,
        explicitSessionKey: `app-server:${threadId}`,
        toolSearchEngine: runtime.runtimeFlags.toolSearchEngine,
      })
      const turnInput = buildTurnInput({
        rawText: '',
        mode,
        planPath: null,
        includeExitPlanReminder,
      })

      const diagnostics = buildContextDiagnosticsPayload({
        cwd: dispatchCwd,
        cfg: runtime.cfg,
        runtimeFlags: runtime.runtimeFlags,
        allowedSubagents: runtime.allowedSubagents,
        mode,
        planPath: null,
        messages: replay?.history ?? [],
        nextTurnFixedGroups: [
          { label: 'Deferred tool exposure', blocks: toolExposure.injectedPromptBlocks },
          { label: 'Mode semantic blocks', blocks: turnInput.semanticBlocks },
        ],
      })

      return {
        stdout:
          format === 'json'
            ? JSON.stringify(diagnostics, null, 2)
            : formatContextDiagnosticsReport({
                diagnostics: diagnostics.snapshot,
                nextTurn: diagnostics.nextTurnFixed,
                mode: diagnostics.mode,
                model: diagnostics.model,
                notes: diagnostics.notes,
              }),
        diagnostics,
      }
    },
    limits: {
      // Exposed verbatim via initialize.result.limits for client-side guardrails.
      maxRequestBytes,
      maxEventBytes,
      maxPendingInputsPerThread,
      defaultInputTtlMs,
      maxInFlightTurnsPerThread: 1,
    },
    emitNotification: (message) => {
      if (!tryEnqueueOutbound(message, true)) {
        process.stderr.write('[formax] dropping server notification: outbound queue is full\n')
      }
    },
  })

  let abortedError: Error | null = null
  const abortPipelines = (err?: unknown): void => {
    if (err && !abortedError) {
      abortedError = toError(err)
    }
    transportAbortController.abort()
    ingressQueue.close()
    outboundQueue.close()
  }

  const writeOutboundLoop = (async () => {
    try {
      while (true) {
        const outbound = await outboundQueue.pop()
        if (outbound === undefined) break
        try {
          await transport.send(outbound.payload)
        } catch (err) {
          if (outbound.swallowSendErrors) {
            continue
          }
          if (err instanceof StdioPayloadTooLargeError) {
            const responseId = (outbound.payload as any)?.id ?? null
            await transportSendSafe(
              makePayloadTooLargeError({
                id: responseId,
                direction: 'event',
                maxBytes: err.maxBytes,
                actualBytes: err.actualBytes,
              }),
            )
            continue
          }
          throw err
        }
      }
    } catch (err) {
      abortPipelines(err)
      throw err
    }
  })()

  const processIngressLoop = (async () => {
    try {
      while (true) {
        const message = await ingressQueue.pop()
        if (message === undefined) break
        const responses = await server.handleMessage(message)
        for (const response of responses) {
          const enqueued = await enqueueOutboundStrict(response)
          if (!enqueued) return
        }
      }
    } catch (err) {
      abortPipelines(err)
      throw err
    }
  })()

  let transportListenError: unknown = null
  try {
    await transport.listen(async (line) => {
      if (abortedError) throw abortedError

      const requestBytes = Buffer.byteLength(line, 'utf8')
      if (requestBytes > maxRequestBytes) {
        const enqueued = await enqueueOutboundStrict(
          makePayloadTooLargeError({
            id: null,
            direction: 'request',
            maxBytes: maxRequestBytes,
            actualBytes: requestBytes,
          }),
        )
        if (!enqueued) return
        return
      }

      const parsed = parseJsonLine(line)
      if (parsed.ok === false) {
        const enqueued = await enqueueOutboundStrict(
          makeErrorResponse(null, {
            code: JSON_RPC_ERRORS.PARSE_ERROR,
            message: parsed.message,
          }),
        )
        if (!enqueued) return
        return
      }

      const message = classifyRpcMessage(parsed.value)
      const queued = ingressQueue.tryPush(message)
      if (queued) return

      if (message.kind === 'request') {
        await enqueueOverloadedError(message.request.id)
        return
      }

      if (message.kind === 'invalid') {
        await enqueueOutboundStrict(
          makeErrorResponse(message.id, {
            code: JSON_RPC_ERRORS.INVALID_REQUEST,
            message: message.message,
          }),
        )
        return
      }

      await ingressQueue.push(message)
    }, { signal: transportAbortController.signal })
  } catch (err) {
    transportListenError = err
    abortPipelines(err)
  } finally {
    ingressQueue.close()
  }

  let processorError: unknown = null
  try {
    await processIngressLoop
  } catch (err) {
    processorError = err
  } finally {
    outboundQueue.close()
  }

  let writerError: unknown = null
  try {
    await writeOutboundLoop
  } catch (err) {
    writerError = err
  }

  if (transportListenError) throw toError(transportListenError)
  if (processorError) throw toError(processorError)
  if (writerError) throw toError(writerError)
  if (abortedError) throw abortedError
}
