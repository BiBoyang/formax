import path from 'node:path'
import pkg from '../../package.json'
import { buildContextDiagnosticsPayload, formatContextDiagnosticsReport } from '../chat/context/contextDiagnostics.js'
import { findSessionFileBySessionId, readSessionFile } from '../features/repl/sessionSave/index.js'
import { resolveSessionMemoryRestoreContext } from '../features/repl/sessionRestore/sessionMemory.js'
import { buildTurnInput } from '../features/semantics/adapters/turnInputBuilder.js'
import { createRuntime } from '../runtime/createRuntime.js'
import { loadRuntimeConfig } from '../config/config.js'
import { createNodeFileStore } from '../config/nodeFileStore.js'
import { getConfigPaths } from '../config/configPaths.js'
import { readConfigPatch, updateConfigPatchFile } from '../config/settings/persist.js'
import { createRuntimeFlags } from '../config/runtimeFlags.js'
import {
  resolveEffectiveRuntimeModelProfile,
  resolveRuntimeModelProfile,
  summarizeRuntimeModelProfile,
} from '../config/runtimeModelProfile.js'
import { buildOpaqueFingerprint } from '../core/models/modelCapability.js'
import { resolveDeferredToolExposureForTurn } from '../tools/runtime/deferredToolExposureResolver.js'
import { applyToolFilters, resolveToolFilters } from '../tools/runtime/toolFilter.js'
import { AppServer } from './server.js'
import { readLatestRequestCollapseEventFromSession } from '../features/repl/sessionSave/requestCollapseEvents.js'
import { readLatestReactiveCompactEventFromSession } from '../features/repl/sessionSave/reactiveCompactEvents.js'
import { readContextCollapseStoreSnapshotFromSession } from '../features/repl/sessionRestore/contextCollapseStore.js'
import { persistDefaultModelTier } from '../features/commands/replEnvironmentService.js'
import { DEFAULT_THINKING_EFFORT, THINKING_EFFORT_VALUES } from '../shared/runtimePreferences.js'
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
const RUNTIME_MODEL_TIERS = ['haiku', 'sonnet', 'opus'] as const
type OutboundQueueItem = {
  payload: unknown
  swallowSendErrors: boolean
}
type AppServerRunner = Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'> &
  Partial<Pick<TurnRunner, 'getPlanPath' | 'adoptPlanPath'>>

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
  turnRunner?: AppServerRunner
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

  let lazyTurnRunner: AppServerRunner | null = args?.turnRunner ?? null
  let latestResolvedTurnRunner: AppServerRunner | null = args?.turnRunner ?? null
  const turnRunnerByProfileFingerprint = new Map<string, AppServerRunner>()
  const turnRunnerByThreadId = new Map<string, AppServerRunner>()
  const initializeConfig = await loadRuntimeConfig(env, cwd, {
    platform: args?.platform,
    homedir: args?.homedir,
  }).catch(() => null)
  const runtimeFlagFingerprintForDefaults = () => JSON.stringify(createRuntimeFlags(env))
  const readRuntimeDefaults = async () => {
    const configPaths = getConfigPaths({ cwd, env, platform: args?.platform, homedir: args?.homedir })
    const fileStore = createNodeFileStore()
    const [runtimeConfig, savedPatch] = await Promise.all([
      loadRuntimeConfig(env, cwd, { platform: args?.platform, homedir: args?.homedir }),
      readConfigPatch({
        fileStore,
        filePath: configPaths.globalConfigPath,
        label: 'global config',
      }),
    ])
    const profile = resolveRuntimeModelProfile({
      cfg: runtimeConfig,
      runtimeFlagFingerprint: runtimeFlagFingerprintForDefaults(),
    })
    return {
      saved: {
        ...(savedPatch.patch.llm?.defaultTier ? { modelTier: savedPatch.patch.llm.defaultTier } : {}),
        ...(typeof savedPatch.patch.llm?.thinkingMode === 'boolean'
          ? { thinkingMode: savedPatch.patch.llm.thinkingMode }
          : {}),
        ...(savedPatch.patch.llm?.thinkingEffort ? { thinkingEffort: savedPatch.patch.llm.thinkingEffort } : {}),
      },
      effective: {
        modelTier: runtimeConfig.llm.defaultTier ?? 'sonnet',
        thinkingMode: runtimeConfig.llm.thinkingMode,
        thinkingEffort: runtimeConfig.llm.thinkingEffort ?? DEFAULT_THINKING_EFFORT,
      },
      profile: summarizeRuntimeModelProfile(profile),
      capabilities: {
        modelTiers: [...RUNTIME_MODEL_TIERS],
        thinkingMode: 'boolean' as const,
        thinkingEffort: {
          provider: 'anthropic' as const,
          values: [...THINKING_EFFORT_VALUES],
          default: DEFAULT_THINKING_EFFORT,
        },
      },
    }
  }
  const server = new AppServer({
    info: {
      name: 'formax',
      version: String((pkg as any).version),
    },
    threadStore,
    initializeUi: {
      showContextMeter: initializeConfig?.ui.showContextMeter ?? true,
    },
    turnRunner: lazyTurnRunner ?? undefined,
    runtimeDefaults: {
      read: readRuntimeDefaults,
      patch: async (params) => {
        const configPaths = getConfigPaths({ cwd, env, platform: args?.platform, homedir: args?.homedir })
        if (params.modelTier) {
          await persistDefaultModelTier({
            nextTier: params.modelTier,
            cwd,
            env,
          })
        }
        if (typeof params.thinkingMode === 'boolean') {
          await updateConfigPatchFile({
            fileStore: createNodeFileStore(),
            filePath: configPaths.globalConfigPath,
            label: 'global config',
            nextPatch: {
              version: 1,
              llm: {
                thinkingMode: params.thinkingMode,
              },
            },
          })
        }
        if (params.thinkingEffort) {
          await updateConfigPatchFile({
            fileStore: createNodeFileStore(),
            filePath: configPaths.globalConfigPath,
            label: 'global config',
            nextPatch: {
              version: 1,
              llm: {
                thinkingEffort: params.thinkingEffort,
              },
            },
          })
        }
        return readRuntimeDefaults()
      },
    },
    resolveEffectiveRuntimeProfileSummary: async ({ preferences }) => {
      const runtimeConfig = await loadRuntimeConfig(env, cwd, {
        platform: args?.platform,
        homedir: args?.homedir,
      })
      return summarizeRuntimeModelProfile(
        resolveEffectiveRuntimeModelProfile({
          cfg: runtimeConfig,
          preferences,
          env,
          runtimeFlagFingerprint: runtimeFlagFingerprintForDefaults(),
        }),
      )
    },
    resolveTurnRunner: async (resolverArgs) => {
      if (lazyTurnRunner) return lazyTurnRunner
      const runtimeCwd = resolverArgs?.cwd ?? cwd
      const runtimeFlags = createRuntimeFlags(env)
      const runtimeConfig = await loadRuntimeConfig(env, runtimeCwd, {
        platform: args?.platform,
        homedir: args?.homedir,
      })
      const runtimeFlagFingerprint = JSON.stringify(runtimeFlags)
      const runtimeProfile = resolveEffectiveRuntimeModelProfile({
        cfg: runtimeConfig,
        preferences: resolverArgs?.preferences,
        env,
        runtimeFlagFingerprint,
      })
      const runtimeConfigFingerprint = buildOpaqueFingerprint(
        JSON.stringify({
          runtimeFlags,
          runtimeConfig,
          preferences: resolverArgs?.preferences ?? {},
        }),
      )
      const runnerCacheKey = `${path.resolve(runtimeCwd)}::${runtimeProfile.fingerprint}::${runtimeConfigFingerprint}`
      const existingThreadRunner = resolverArgs?.threadId ? turnRunnerByThreadId.get(resolverArgs.threadId) ?? null : null
      const cachedRunner = turnRunnerByProfileFingerprint.get(runnerCacheKey)
      if (cachedRunner) {
        if (resolverArgs?.threadId && existingThreadRunner && existingThreadRunner !== cachedRunner) {
          const existingPlanPath = existingThreadRunner.getPlanPath?.(resolverArgs.threadId) ?? null
          if (existingPlanPath) {
            cachedRunner.adoptPlanPath?.(resolverArgs.threadId, existingPlanPath)
          }
        }
        latestResolvedTurnRunner = cachedRunner
        if (resolverArgs?.threadId) turnRunnerByThreadId.set(resolverArgs.threadId, cachedRunner)
        return cachedRunner
      }
      const runtime = await createRuntime({ cwd: runtimeCwd, env, runtimeFlags })
      const runner = new TurnRunner({
        engine: runtime.engine,
        tools: runtime.tools,
        allowedSubagents: runtime.allowedSubagents,
        model: runtime.cfg.llm.model,
        thinkingEnabled: runtime.cfg.llm.thinkingMode,
        cwd: runtimeCwd,
        env,
        platform: args?.platform,
        homedir: args?.homedir,
        userInputManager: runtime.userInputManager,
        emitNotification: server.createTurnNotificationEmitter(),
        defaultInputTtlMs,
        maxPendingInputsPerThread,
        runtimeFlags: runtime.runtimeFlags,
        ensureThreadFilePath:
          typeof threadStore.ensureThreadFile === 'function'
            ? ({ threadId, cwd: threadCwd }) => threadStore.ensureThreadFile!({ threadId, cwd: threadCwd })
            : undefined,
      })
      turnRunnerByProfileFingerprint.set(runnerCacheKey, runner)
      if (resolverArgs?.threadId && existingThreadRunner && existingThreadRunner !== runner) {
        const existingPlanPath = existingThreadRunner.getPlanPath?.(resolverArgs.threadId) ?? null
        if (existingPlanPath) {
          runner.adoptPlanPath?.(resolverArgs.threadId, existingPlanPath)
        }
      }
      latestResolvedTurnRunner = runner
      if (resolverArgs?.threadId) turnRunnerByThreadId.set(resolverArgs.threadId, runner)
      return runner
    },
    resolveContextDiagnostics: async ({
      threadId,
      cwd: dispatchCwd,
      mode,
      modeExplicit,
      includeExitPlanReminder,
      nextTurnInjectedBlocks = [],
      preferences,
      format,
    }) => {
      const runtime = await createRuntime({ cwd: dispatchCwd, env })
      const runtimeFlagFingerprint = JSON.stringify(runtime.runtimeFlags ?? {})
      const runtimeProfile = resolveEffectiveRuntimeModelProfile({
        cfg: runtime.cfg,
        preferences,
        env,
        runtimeFlagFingerprint,
      })
      const sessionFilePath = await findSessionFileBySessionId({
        cwd: dispatchCwd,
        env,
        platform: args?.platform,
        homedir: args?.homedir,
        sessionId: threadId,
      })
      const replay = sessionFilePath ? await readSessionFile(sessionFilePath) : null
      const livePlanPath =
        turnRunnerByThreadId.get(threadId)?.getPlanPath?.(threadId) ??
        latestResolvedTurnRunner?.getPlanPath?.(threadId) ??
        null
      const restoreContext = sessionFilePath
        ? await resolveSessionMemoryRestoreContext({
            sessionFilePath,
            fallbackMode: mode,
            fallbackPlanPath: livePlanPath,
          })
        : { mode, planPath: livePlanPath }
      const diagnosticsMode = modeExplicit ? mode : restoreContext.mode
      const deferredToolExposureEnabled = runtime.runtimeFlags.deferredToolExposureEnabled === true
      const { allowTools, disallowedTools } = resolveToolFilters({
        env,
        interactive: true,
      })
      const filteredTools = applyToolFilters({
        tools: runtime.tools,
        allowTools,
        disallowedTools,
      })
      const toolExposure = resolveDeferredToolExposureForTurn({
        cwd: dispatchCwd,
        tools: filteredTools,
        deferredToolExposureEnabled,
        toolSearchEnabled: !disallowedTools?.includes('ToolSearch'),
        explicitSessionKey: `app-server:${threadId}`,
        toolSearchEngine: runtime.runtimeFlags.toolSearchEngine,
      })
      const turnInput = buildTurnInput({
        rawText: '',
        mode: diagnosticsMode,
        planPath: restoreContext.planPath,
        includeExitPlanReminder,
      })

      const latestRequestCollapse = sessionFilePath
        ? await readLatestRequestCollapseEventFromSession({ filePath: sessionFilePath })
        : null
      const latestReactiveCompact = sessionFilePath
        ? await readLatestReactiveCompactEventFromSession({ filePath: sessionFilePath })
        : null
      const contextCollapseStoreSnapshot = sessionFilePath
        ? await readContextCollapseStoreSnapshotFromSession({ filePath: sessionFilePath }).catch(() => null)
        : null

      const diagnostics = buildContextDiagnosticsPayload({
        cwd: dispatchCwd,
        cfg: runtime.cfg,
        runtimeModelProfile: runtimeProfile,
        runtimeFlags: runtime.runtimeFlags,
        allowedSubagents: runtime.allowedSubagents,
        mode: diagnosticsMode,
        planPath: restoreContext.planPath,
        messages: replay?.history ?? [],
        latestRequestCollapse,
        latestReactiveCompact,
        durableState: contextCollapseStoreSnapshot ? { collapse: contextCollapseStoreSnapshot } : undefined,
        nextTurnFixedGroups: [
          { label: 'Deferred tool exposure', blocks: toolExposure.injectedPromptBlocks },
          { label: 'Mode semantic blocks', blocks: turnInput.semanticBlocks },
          ...(nextTurnInjectedBlocks.length > 0
            ? [{ label: 'Pending restore injected blocks', blocks: nextTurnInjectedBlocks }]
            : []),
        ],
      })

      return {
        stdout:
          format === 'json'
            ? JSON.stringify(diagnostics, null, 2)
            : formatContextDiagnosticsReport({
                latestCompactBoundary: diagnostics.latestCompactBoundary,
                latestRequestCollapse: diagnostics.latestRequestCollapse,
                latestReactiveCompact: diagnostics.latestReactiveCompact,
                diagnostics: diagnostics.snapshot,
                nextTurn: diagnostics.nextTurnFixed,
                projectionLayers: diagnostics.projectionLayers,
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
