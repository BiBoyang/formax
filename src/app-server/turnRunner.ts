import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { rebuildHistoryAfterCompaction } from '../chat/context/compact.js'
import type { ChatEngine, ChatHistory } from '../chat/engine.js'
import type { PromptBlock } from '../prompts/index.js'
import { buildSystemPrompt, type SystemPromptProfile } from '../prompts/index.js'
import { buildCompactRequest } from '../prompts/compact.js'
import { findSessionFileBySessionId, readSessionFile, SessionWriter } from '../features/repl/sessionSave/index.js'
import type { Msg } from '../shared/toolMessageTypes.js'
import { sourceFromInputKind } from '../shared/inputContracts.js'
import { sourceFromRuntimeEventType } from '../shared/runtimeEventSource.js'
import type { StreamEvent } from '../streaming/types.js'
import type { ToolDefinition } from '../tools/types.js'
import { resolveDeferredToolExposureForTurn } from '../tools/runtime/deferredToolExposureResolver.js'
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
import { resolveCommandRouting } from '../features/semantics/core/commandRouting.js'
import { buildTurnInput } from '../features/semantics/adapters/turnInputBuilder.js'
import {
  normalizeReplMode,
  resolveReplModeTransition,
  type ReplMode,
} from '../features/semantics/core/replModeTransition.js'
import { computeEditPatchStartLineNumber } from '../features/repl/controller/streaming/patchStartLineNumber.js'
import { toolResultContentToText } from '../shared/utils/toolResultContent.js'
import { createRuntimeFlags, type RuntimeFlags } from '../config/runtimeFlags.js'

type TurnStatus = 'running' | 'completed' | 'failed' | 'interrupted'

type TurnStartRuntimeParams = TurnStartParams & {
  includeExitPlanReminder?: boolean
}

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
  replMode: ReplMode
  abortController: AbortController
  inputStore: TurnInputStore
  writer: SessionWriter | null
  pendingEventWrites: Array<Promise<void>>
  inputExpiryTimers: Map<string, ReturnType<typeof setTimeout>>
  compact: {
    isCommand: boolean
    instructions: string
  }
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
  private readonly ensureThreadFilePath?: (args: { threadId: string; cwd: string }) => Promise<string>
  private readonly runtimeFlags: RuntimeFlags
  private readonly threadFilePathById = new Map<string, string>()
  private readonly runningByThreadId = new Map<string, RunningTurn>()
  private readonly autoTitleAttemptedThreadIds = new Set<string>()
  private readonly autoTitleCheckedTopicPromptKeys = new Set<string>()

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
    this.ensureThreadFilePath = args.ensureThreadFilePath
    this.runtimeFlags = args.runtimeFlags ?? createRuntimeFlags(this.env ?? process.env)
  }

  async startTurn(params: TurnStartRuntimeParams): Promise<{ turn: { id: string; threadId: string; status: TurnStatus } }> {
    const existing = this.runningByThreadId.get(params.threadId)
    if (existing) throw new Error(`Turn already running for thread: ${params.threadId}`)

    const cwd = params.cwd ? path.resolve(params.cwd) : this.cwd
    const filePath = await this.resolveOrCreateThreadFilePath({ threadId: params.threadId, cwd })

    const initialMode = normalizeReplMode(params.mode, 'normal')
    const turnInput = buildTurnInput({
      rawText: params.input.text,
      mode: initialMode,
      planPath: null,
      includeExitPlanReminder: Boolean(params.includeExitPlanReminder),
    })
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
      modelUserContent: [...turnInput.semanticBlocks, ...turnInput.userBlocks],
      semanticBlockCount: turnInput.semanticBlocks.length,
      replMode: initialMode,
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
      toolNameByUseId: new Map<string, string>(),
      toolInputByUseId: new Map<string, unknown>(),
    }
    this.runningByThreadId.set(params.threadId, running)

    this.emitTurnNotification(running, 'turn/started', 'system', {
      turn: {
        id: running.turnId,
        threadId: running.threadId,
        status: 'running',
        mode: running.replMode,
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

      const userMsg: Msg = {
        id: `user-${Date.now()}-${running.turnId}`,
        role: 'user',
        content: running.inputText,
        timestamp: new Date(),
      }
      await writer.appendStableMsg(userMsg)

      const toolExposure = resolveDeferredToolExposureForTurn({
        cwd: running.cwd,
        tools: this.tools,
        deferredToolExposureEnabled: this.runtimeFlags.deferredToolExposureEnabled === true,
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
        model: this.model,
        profile: this.promptProfile,
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

      if (running.compact.isCommand) {
        await writer.appendEvent('compact_started', { source: 'manual' })
        const compactPrompt: ChatHistory[number] = {
          role: 'user',
          content: [{ type: 'text', text: buildCompactRequest(running.compact.instructions) }],
        }
        const compactHistory = await this.engine.runTurn({
          history,
          user: compactPrompt,
          system,
          tools: [],
          onEvent: (event) => {
            if (event.type === 'thinking_delta' || event.type === 'thinking_stop' || event.type === 'usage') {
              emitStreamTurnEvent(event)
            }
          },
          cwd: running.cwd,
          signal: running.abortController.signal,
          thinkingEnabled: this.thinkingEnabled,
          exec: {
            interactive: true,
            replMode: running.replMode,
            getReplMode,
            setReplMode,
            trace: turnTrace,
          },
        })
        if (running.abortController.signal.aborted) {
          throw new Error('Request aborted')
        }
        const summary = extractAssistantText(compactHistory).trim()
        if (!summary) {
          throw new Error('Compact failed: empty summary')
        }
        nextHistoryForSnapshot = rebuildHistoryAfterCompaction({
          summary,
          previousHistory: history,
          keepLastTurns: MANUAL_COMPACT_KEEP_LAST_TURNS,
        })
        assistantText = COMPACT_BANNER_TEXT
        emitStreamTurnEvent({ type: 'assistant_delta', text: assistantText })
        await writer.appendEvent('compact_succeeded', {
          source: 'manual',
          summaryChars: summary.length,
        })
      } else {
        const nextHistory = await this.engine.runTurn({
          history,
          user,
          system,
          tools,
          ...(toolExposure.resolveToolsForCall ? { resolveToolsForCall: toolExposure.resolveToolsForCall } : {}),
          onEvent,
          cwd: running.cwd,
          signal: running.abortController.signal,
          thinkingEnabled: this.thinkingEnabled,
          exec: {
            interactive: true,
            replMode: running.replMode,
            getReplMode,
            setReplMode,
            trace: turnTrace,
            ...(toolExposure.toolExposureSessionKey
              ? { toolExposureSessionKey: toolExposure.toolExposureSessionKey }
              : {}),
          },
        })
        if (running.abortController.signal.aborted) {
          throw new Error('Request aborted')
        }
        nextHistoryForSnapshot =
          running.semanticBlockCount + exposureInjectedBlockCount > 0
            ? stripInjectedBlocksFromHistory(
                nextHistory as ChatHistory,
                history.length,
                running.semanticBlockCount + exposureInjectedBlockCount,
              )
            : (nextHistory as ChatHistory)
      }

      const historyForSnapshot = nextHistoryForSnapshot

      if (assistantText.trim()) {
        await writer.appendStableMsg({
          id: `assistant-${Date.now()}-${running.turnId}`,
          role: 'assistant',
          content: assistantText,
          timestamp: new Date(),
        })
      }
      await writer.appendHistorySnapshot(historyForSnapshot)
      const firstUserPrompt = firstUserPromptFromHistory(history) ?? running.inputText
      const uiMsgCount = historyForSnapshot.filter((message) => message.role === 'user' || message.role === 'assistant').length
      await writer.appendEvent('ui_stats', {
        uiMsgCount,
        firstUserPrompt,
        lastUserPrompt: running.inputText,
      })
      if (shouldAutoGenerateTitle) {
        await maybeAutoGenerateSessionTitle({
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

  private async resolveOrCreateThreadFilePath(args: { threadId: string; cwd: string }): Promise<string> {
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
      model: this.model,
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
}
