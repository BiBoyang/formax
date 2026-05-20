import { randomUUID } from 'node:crypto'
import { SessionWriter } from '../../features/repl/sessionSave/writer.js'
import type { PromptMessage } from '../../prompts/index.js'
import {
  buildSessionReplayHistoryWithActiveContinuation,
  isCompactBoundaryMessage,
} from '../../chat/context/compact.js'

type QuerySessionWriter = Pick<
  SessionWriter,
  'appendEvent' | 'appendHistorySnapshot' | 'appendStableMsg' | 'shutdown'
>

export type QuerySessionPersistence = {
  sessionId: string
  filePath: string
  writer: QuerySessionWriter
}

function promptMessageToText(message: PromptMessage): string {
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      if ((block as { type?: unknown }).type !== 'text') return ''
      const text = (block as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
    .trim()
}

function firstUserPromptFromHistory(history: PromptMessage[]): string | null {
  for (const message of history) {
    if (!message || message.role !== 'user') continue
    const text = promptMessageToText(message)
    if (!text) continue
    return text
  }
  return null
}

function countUiMessages(history: PromptMessage[]): number {
  return history.reduce((count, message) => {
    if (!message) return count
    if (isCompactBoundaryMessage(message)) return count
    if (message.role === 'user' || message.role === 'assistant') return count + 1
    return count
  }, 0)
}

export async function initializeQuerySessionPersistence(args: {
  enabled: boolean
  sessionId: string
  sessionFilePath: string | null
  cwd: string
  env: NodeJS.ProcessEnv
  model: string
}): Promise<QuerySessionPersistence | null> {
  if (!args.enabled) return null

  if (args.sessionFilePath) {
    const writer = await SessionWriter.openExisting({
      filePath: args.sessionFilePath,
    })
    return {
      sessionId: args.sessionId,
      filePath: args.sessionFilePath,
      writer,
    }
  }

  const created = await SessionWriter.createNew({
    cwd: args.cwd,
    env: args.env,
    model: args.model,
    sessionId: args.sessionId,
  })
  return {
    sessionId: created.meta.sessionId,
    filePath: created.filePath,
    writer: created.writer,
  }
}

export async function persistQueryTurn(args: {
  persistence: QuerySessionPersistence
  cwd: string
  prompt: string
  assistantText: string
  history: PromptMessage[]
  replayHistory?: PromptMessage[] | null
}): Promise<void> {
  const userPrompt = args.prompt.trim()
  const timestamp = new Date()
  const turnId = randomUUID()

  await args.persistence.writer.appendEvent('app_turn_started', {
    traceId: randomUUID(),
    threadId: args.persistence.sessionId,
    turnId,
    cwd: args.cwd,
  })

  await args.persistence.writer.appendStableMsg({
    id: `user-${turnId}`,
    role: 'user',
    content: userPrompt,
    timestamp,
  })

  const assistant = args.assistantText.trim()
  if (assistant) {
    await args.persistence.writer.appendStableMsg({
      id: `assistant-${turnId}`,
      role: 'assistant',
      content: assistant,
      timestamp,
    })
  }

  const historySnapshot = args.replayHistory
    ? buildSessionReplayHistoryWithActiveContinuation({
        replayHistory: args.replayHistory,
        activeHistory: args.history,
      })
    : args.history
  await args.persistence.writer.appendHistorySnapshot(historySnapshot)

  const firstUserPrompt = firstUserPromptFromHistory(args.history) ?? userPrompt
  await args.persistence.writer.appendEvent('ui_stats', {
    uiMsgCount: countUiMessages(args.history),
    firstUserPrompt,
    lastUserPrompt: userPrompt,
  })
}

export async function shutdownQuerySessionPersistence(
  persistence: QuerySessionPersistence | null,
): Promise<void> {
  if (!persistence) return
  await persistence.writer.shutdown().catch(() => undefined)
}
