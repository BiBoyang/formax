import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ChatEngine, ChatHistory } from '../chat/engine.js'
import { buildSystemPrompt, buildUserContent, type SystemPromptProfile } from '../prompts/index.js'
import { findSessionFileBySessionId, readSessionFile, SessionWriter } from '../features/repl/sessionSave/index.js'
import type { Msg } from '../components/tool/ToolMessage.js'
import type { StreamEvent } from '../streaming/types.js'
import type { ToolDefinition } from '../tools/types.js'
import { buildSkillToolSpecForCwd } from '../tools/modules/skill/index.js'
import type { UserInputManager } from '../tools/runtime/userInputManager.js'
import type { InputEnvelopeMeta, InputKind, InputResolvedPayload, TurnInputSubmitResult } from './protocol/input.js'
import type { TurnInputSubmitParams, TurnInterruptParams, TurnStartParams } from './protocol.js'
import { TurnInputStore } from './turn/inputStore.js'

type TurnStatus = 'running' | 'completed' | 'failed' | 'interrupted'

export type TurnRunnerNotificationEmitter = (method: string, params?: unknown) => void

export type TurnRunnerOptions = {
  engine: Pick<ChatEngine, 'runTurn'>
  tools: ToolDefinition[]
  allowedSubagents: Array<{ name: string; description: string }>
  model: string
  promptProfile: SystemPromptProfile
  thinkingEnabled?: boolean
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
  userInputManager?: UserInputManager | null
  emitNotification: TurnRunnerNotificationEmitter
  defaultInputTtlMs?: number
  maxPendingInputsPerThread?: number
}

type RunningTurn = {
  turnId: string
  traceId: string
  seq: number
  threadId: string
  filePath: string
  cwd: string
  inputText: string
  abortController: AbortController
  inputStore: TurnInputStore
  writer: SessionWriter | null
  pendingEventWrites: Array<Promise<void>>
}

export const DEFAULT_INPUT_TTL_MS = 5 * 60_000
export const DEFAULT_MAX_PENDING_INPUTS_PER_THREAD = 32

function patchToolsForTurn(tools: ToolDefinition[], cwd: string): ToolDefinition[] {
  return tools.map((t) => (t.name === 'Skill' ? buildSkillToolSpecForCwd(cwd) : t))
}

function sourceFromStreamEvent(event: StreamEvent): InputEnvelopeMeta['source'] {
  if (event.type === 'approval_request') return 'policy'
  if (event.type === 'ask_user_question') return 'tool'
  if (event.type.startsWith('tool_')) return 'tool'
  if (event.type === 'error') return 'system'
  return 'engine'
}

function sourceFromInputKind(kind: InputKind): InputEnvelopeMeta['source'] {
  return kind === 'approval' ? 'policy' : 'tool'
}

function normalizePositiveLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  return rounded >= 1 ? rounded : fallback
}

export class TurnRunner {
  private readonly engine: Pick<ChatEngine, 'runTurn'>
  private readonly tools: ToolDefinition[]
  private readonly allowedSubagents: Array<{ name: string; description: string }>
  private readonly model: string
  private readonly promptProfile: SystemPromptProfile
  private readonly thinkingEnabled: boolean
  private readonly cwd: string
  private readonly env?: NodeJS.ProcessEnv
  private readonly platform?: string
  private readonly homedir?: string
  private readonly userInputManager: UserInputManager | null
  private readonly emitNotification: TurnRunnerNotificationEmitter
  private readonly defaultInputTtlMs: number
  private readonly maxPendingInputsPerThread: number
  private readonly runningByThreadId = new Map<string, RunningTurn>()

  constructor(args: TurnRunnerOptions) {
    this.engine = args.engine
    this.tools = args.tools
    this.allowedSubagents = args.allowedSubagents
    this.model = args.model
    this.promptProfile = args.promptProfile
    this.thinkingEnabled = Boolean(args.thinkingEnabled)
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
  }

  async startTurn(params: TurnStartParams): Promise<{ turn: { id: string; threadId: string; status: TurnStatus } }> {
    const existing = this.runningByThreadId.get(params.threadId)
    if (existing) throw new Error(`Turn already running for thread: ${params.threadId}`)

    const filePath = await this.resolveThreadFilePath(params.threadId)
    if (!filePath) throw new Error(`Thread not found: ${params.threadId}`)

    const turnId = randomUUID()
    const running: RunningTurn = {
      turnId,
      traceId: randomUUID(),
      seq: 0,
      threadId: params.threadId,
      filePath,
      cwd: params.cwd ? path.resolve(params.cwd) : this.cwd,
      inputText: params.input.text,
      abortController: new AbortController(),
      inputStore: new TurnInputStore({
        threadId: params.threadId,
        turnId,
        defaultInputTtlMs: this.defaultInputTtlMs,
        maxPendingInputs: this.maxPendingInputsPerThread,
      }),
      writer: null,
      pendingEventWrites: [],
    }
    this.runningByThreadId.set(params.threadId, running)

    this.emitTurnNotification(running, 'turn/started', 'system', {
      turn: {
        id: running.turnId,
        threadId: running.threadId,
        status: 'running',
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

    try {
      writer = await SessionWriter.openExisting({ filePath: running.filePath })
      running.writer = writer
      await writer.appendEvent('app_turn_started', {
        traceId: running.traceId,
        threadId: running.threadId,
        turnId: running.turnId,
      })
      const replay = await readSessionFile(running.filePath)
      const history = replay.history

      const userMsg: Msg = {
        id: `user-${Date.now()}-${running.turnId}`,
        role: 'user',
        content: running.inputText,
        timestamp: new Date(),
      }
      await writer.appendStableMsg(userMsg)

      const user = {
        role: 'user' as const,
        content: buildUserContent(running.inputText),
      }
      const system = buildSystemPrompt({
        allowedSubagents: this.allowedSubagents,
        cwd: running.cwd,
        model: this.model,
        profile: this.promptProfile,
      })
      const tools = patchToolsForTurn(this.tools, running.cwd)

      let assistantText = ''
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
          this.emitTurnNotification(running, 'turn/inputRequested', 'tool', {
            threadId: running.threadId,
            turnId: running.turnId,
            input,
          })
          this.appendAppEvent(running, 'app_input_requested', input)
          return
        }

        if (event.type === 'assistant_delta') assistantText += event.text
        this.emitTurnNotification(running, 'turn/event', sourceFromStreamEvent(event), {
          turnId: running.turnId,
          threadId: running.threadId,
          event,
        })
      }

      if (running.abortController.signal.aborted) {
        throw new Error('Request aborted')
      }
      const nextHistory = await this.engine.runTurn({
        history,
        user,
        system,
        tools,
        onEvent,
        cwd: running.cwd,
        signal: running.abortController.signal,
        thinkingEnabled: this.thinkingEnabled,
        exec: { interactive: false },
      })
      if (running.abortController.signal.aborted) {
        throw new Error('Request aborted')
      }

      if (assistantText.trim()) {
        await writer.appendStableMsg({
          id: `assistant-${Date.now()}-${running.turnId}`,
          role: 'assistant',
          content: assistantText,
          timestamp: new Date(),
        })
      }
      await writer.appendHistorySnapshot(nextHistory as ChatHistory)
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
      running.writer = null
      this.runningByThreadId.delete(running.threadId)
    }

    if (status === 'completed') {
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
      error: errorMessage ?? 'Unknown error',
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

  private emitResolvedInput(running: RunningTurn, input: InputResolvedPayload): void {
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
      source,
      ...params,
    })
  }

  private async resolveThreadFilePath(threadId: string): Promise<string | null> {
    return findSessionFileBySessionId({
      cwd: this.cwd,
      sessionId: threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
  }

  private appendAppEvent(running: RunningTurn, name: string, data: Record<string, unknown>): void {
    if (!running.writer) return
    const write = running.writer.appendEvent(name, data).catch(() => undefined)
    running.pendingEventWrites.push(write)
  }
}
