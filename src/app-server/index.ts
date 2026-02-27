import pkg from '../../package.json'
import { createRuntime } from '../runtime/createRuntime.js'
import { AppServer } from './server.js'
import { classifyRpcMessage, JSON_RPC_ERRORS, makeErrorResponse, parseJsonLine } from './jsonrpc.js'
import { ThreadStore } from './threadStore.js'
import { DEFAULT_INPUT_TTL_MS, DEFAULT_MAX_PENDING_INPUTS_PER_THREAD, TurnRunner } from './turnRunner.js'
import { createStdioJsonlTransport, StdioPayloadTooLargeError } from './transport/stdio.js'

export const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024
export const DEFAULT_MAX_EVENT_BYTES = 1024 * 1024

function normalizePositiveLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  return rounded >= 1 ? rounded : fallback
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
}): Promise<void> {
  const cwd = args?.cwd ?? process.cwd()
  const env = args?.env ?? process.env
  const maxRequestBytes = normalizePositiveLimit(args?.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES)
  const maxEventBytes = normalizePositiveLimit(args?.maxEventBytes, DEFAULT_MAX_EVENT_BYTES)
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

  const safeSend = async (message: unknown): Promise<void> => {
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
        promptProfile: runtime.cfg.ui.promptProfile,
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
    limits: {
      // Exposed verbatim via initialize.result.limits for client-side guardrails.
      maxRequestBytes,
      maxEventBytes,
      maxPendingInputsPerThread,
      defaultInputTtlMs,
      maxInFlightTurnsPerThread: 1,
    },
    emitNotification: (message) => {
      void transport.send(message).catch(() => undefined)
    },
  })

  await transport.listen(async (line) => {
    const requestBytes = Buffer.byteLength(line, 'utf8')
    if (requestBytes > maxRequestBytes) {
      await safeSend(
        makeErrorResponse(null, {
          code: JSON_RPC_ERRORS.PAYLOAD_TOO_LARGE,
          message: 'PAYLOAD_TOO_LARGE',
          data: {
            kind: 'PAYLOAD_TOO_LARGE',
            recoverable: true,
            retryable: true,
            direction: 'request',
            maxBytes: maxRequestBytes,
            actualBytes: requestBytes,
          },
        }),
      )
      return
    }

    const parsed = parseJsonLine(line)
    if (parsed.ok === false) {
      await safeSend(
        makeErrorResponse(null, {
          code: JSON_RPC_ERRORS.PARSE_ERROR,
          message: parsed.message,
        }),
      )
      return
    }

    const message = classifyRpcMessage(parsed.value)
    const responses = await server.handleMessage(message)
    for (const response of responses) {
      try {
        await transport.send(response)
      } catch (err) {
        if (err instanceof StdioPayloadTooLargeError) {
          const responseId = (response as any)?.id ?? null
          await safeSend(
            makeErrorResponse(responseId, {
              code: JSON_RPC_ERRORS.PAYLOAD_TOO_LARGE,
              message: 'PAYLOAD_TOO_LARGE',
              data: {
                kind: 'PAYLOAD_TOO_LARGE',
                recoverable: true,
                retryable: true,
                direction: 'event',
                maxBytes: err.maxBytes,
                actualBytes: err.actualBytes,
              },
            }),
          )
          continue
        }
        throw err
      }
    }
  })
}
