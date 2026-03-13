import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import {
  extractLastAssistantTextFromHistory,
  maybeAutoGenerateSessionTitle,
  type MaybeAutoGenerateSessionTitleArgs,
} from '../../../sessionTitle'
import { shouldPersistUiMsg } from './sessionLifecycle'

type TurnCompletionWriter = {
  filePath: string
  appendHistorySnapshot: (history: ChatHistory) => Promise<void>
  appendEvent: (name: string, data?: Record<string, unknown>) => Promise<void>
}

type AutoGenerateSessionTitle = (args: MaybeAutoGenerateSessionTitleArgs) => Promise<string | null>
type AssistantTextExtractor = (history: ChatHistory) => string | null

export function collectUiStatsForTurnCompletion(messages: Msg[]): {
  uiMsgCount: number
  firstUserPrompt: string | null
  lastUserPrompt: string | null
} {
  const uiMsgCount = messages.filter(shouldPersistUiMsg).length
  const userPrompts = messages
    .filter((message) => message.role === 'user')
    .map((message) => String(message.content ?? '').trim())
    .filter((text) => text.length > 0)

  return {
    uiMsgCount,
    firstUserPrompt: userPrompts[0] ?? null,
    lastUserPrompt: userPrompts[userPrompts.length - 1] ?? null,
  }
}

export function runSessionTurnCompletionSideEffects(args: {
  writer: TurnCompletionWriter | null
  wasLoading: boolean
  isLoading: boolean
  history: ChatHistory
  messages: Msg[]
  engine: Pick<ChatEngine, 'runTurn'>
  cwd: string
  attemptedSessionIds: Set<string>
  checkedTopicPromptKeys: Set<string>
  model: string
  autoGenerateSessionTitle?: AutoGenerateSessionTitle
  extractAssistantText?: AssistantTextExtractor
}): void {
  if (!args.writer) return
  if (!args.wasLoading || args.isLoading) return

  const { uiMsgCount, firstUserPrompt, lastUserPrompt } = collectUiStatsForTurnCompletion(args.messages)
  void args.writer.appendHistorySnapshot(args.history)
  void args.writer.appendEvent('ui_stats', { uiMsgCount, lastUserPrompt, firstUserPrompt })

  const assistantText = (args.extractAssistantText ?? extractLastAssistantTextFromHistory)(args.history)
  const autoGenerate = args.autoGenerateSessionTitle ?? maybeAutoGenerateSessionTitle
  void autoGenerate({
    filePath: args.writer.filePath,
    engine: args.engine,
    cwd: args.cwd,
    attemptedSessionIds: args.attemptedSessionIds,
    checkedTopicPromptKeys: args.checkedTopicPromptKeys,
    writer: args.writer,
    userText: firstUserPrompt ?? lastUserPrompt,
    topicUserText: lastUserPrompt,
    assistantText,
    model: args.model,
  }).catch(() => null)
}
