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
  parseInitializeParams,
  parseThreadByIdParams,
  parseThreadListParams,
  parseThreadStartParams,
  parseTurnInputSubmitParams,
  parseTurnInterruptParams,
  parseTurnStartParams,
} from './protocol.js'
import { ThreadStore, type ThreadListResult, type ThreadReadResult, type ThreadResumeResult } from './threadStore.js'
import { TurnRunner } from './turnRunner.js'

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
  threadStore?: Pick<ThreadStore, 'startThread' | 'resumeThread' | 'listThreads' | 'readThread'>
  turnRunner?: Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>
  resolveTurnRunner?: () => Promise<Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>>
  emitNotification?: (message: { jsonrpc: '2.0'; method: string; params?: unknown }) => void
}

export class AppServer {
  private readonly info: AppServerInfo
  private readonly threadStore: Pick<ThreadStore, 'startThread' | 'resumeThread' | 'listThreads' | 'readThread'>
  private turnRunner: Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'> | null
  private readonly resolveTurnRunner?: () => Promise<Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>>
  private readonly emitNotification?: (message: { jsonrpc: '2.0'; method: string; params?: unknown }) => void
  private readonly staleInputIds = new Set<string>()
  private readonly staleInputIdsByToolUseId = new Map<string, string>()

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

    if (req.method === 'turn/start') {
      try {
        const params = parseTurnStartParams(req.params)
        const runner = await this.getTurnRunner()
        const result = await runner.startTurn(params)
        return [makeSuccessResponse(req.id, result)]
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

  createTurnNotificationEmitter(): (method: string, params?: unknown) => void {
    return (method, params) => {
      this.emitNotification?.({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
    }
  }
}
