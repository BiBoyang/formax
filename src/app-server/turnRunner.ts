import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ChatEngine, ChatHistory } from '../chat/engine.js'
import { buildSystemPrompt, buildUserContent, type SystemPromptProfile } from '../prompts/index.js'
import { findSessionFileBySessionId, readSessionFile, SessionWriter } from '../features/repl/sessionSave/index.js'
import type { Msg } from '../components/tool/ToolMessage.js'
import type { StreamEvent } from '../streaming/types.js'
import type { ToolDefinition } from '../tools/types.js'
import { buildSkillToolSpecForCwd } from '../tools/modules/skill/index.js'
import type { TurnInterruptParams, TurnStartParams } from './protocol.js'

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
  emitNotification: TurnRunnerNotificationEmitter
}

type RunningTurn = {
  turnId: string
  threadId: string
  filePath: string
  cwd: string
  inputText: string
  abortController: AbortController
}

function patchToolsForTurn(tools: ToolDefinition[], cwd: string): ToolDefinition[] {
  return tools.map((t) => (t.name === 'Skill' ? buildSkillToolSpecForCwd(cwd) : t))
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
  private readonly emitNotification: TurnRunnerNotificationEmitter
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
    this.emitNotification = args.emitNotification
  }

  async startTurn(params: TurnStartParams): Promise<{ turn: { id: string; threadId: string; status: TurnStatus } }> {
    const existing = this.runningByThreadId.get(params.threadId)
    if (existing) throw new Error(`Turn already running for thread: ${params.threadId}`)

    const filePath = await this.resolveThreadFilePath(params.threadId)
    if (!filePath) throw new Error(`Thread not found: ${params.threadId}`)

    const turnId = randomUUID()
    const running: RunningTurn = {
      turnId,
      threadId: params.threadId,
      filePath,
      cwd: params.cwd ? path.resolve(params.cwd) : this.cwd,
      inputText: params.input.text,
      abortController: new AbortController(),
    }
    this.runningByThreadId.set(params.threadId, running)

    this.emitNotification('turn/started', {
      turn: {
        id: running.turnId,
        threadId: running.threadId,
        status: 'running',
      },
    })

    void this.runTurnInBackground(running).catch((err) => {
      this.runningByThreadId.delete(running.threadId)
      this.emitNotification('turn/failed', {
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
    running.abortController.abort()
    return {}
  }

  private async runTurnInBackground(running: RunningTurn): Promise<void> {
    let writer: SessionWriter | null = null
    let status: TurnStatus = 'running'
    let errorMessage: string | null = null

    try {
      writer = await SessionWriter.openExisting({ filePath: running.filePath })
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
        if (event.type === 'assistant_delta') assistantText += event.text
        this.emitNotification('turn/event', {
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
      if (writer) {
        const shutdownError = await writer.shutdown().then(() => null).catch((err) => err)
        if (shutdownError && status === 'completed') {
          status = 'failed'
          errorMessage = shutdownError instanceof Error ? shutdownError.message : String(shutdownError)
        }
      }
      this.runningByThreadId.delete(running.threadId)
    }

    if (status === 'completed') {
      this.emitNotification('turn/completed', {
        turn: {
          id: running.turnId,
          threadId: running.threadId,
          status,
        },
      })
      return
    }

    this.emitNotification('turn/failed', {
      turn: {
        id: running.turnId,
        threadId: running.threadId,
        status,
      },
      error: errorMessage ?? 'Unknown error',
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
}
