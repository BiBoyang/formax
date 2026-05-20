import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { ReplMode } from '../../mode'
import { buildSessionReplayHistoryWithActiveContinuation } from '../../../../chat/context/compact'
import {
  extractLastAssistantTextFromHistory,
  maybeAutoGenerateSessionTitle,
  type MaybeAutoGenerateSessionTitleArgs,
} from '../../../sessionTitle'
import { persistRollingSessionMemory } from './sessionRollingMemory'
import { shouldPersistUiMsg } from './sessionLifecycle'

type TurnCompletionWriter = {
  filePath: string
  appendHistorySnapshot: (history: ChatHistory) => Promise<void>
  appendEvent: (name: string, data?: Record<string, unknown>) => Promise<void>
}

type AutoGenerateSessionTitle = (args: MaybeAutoGenerateSessionTitleArgs) => Promise<string | null>
type AssistantTextExtractor = (history: ChatHistory) => string | null
type PersistRollingSessionMemory = (args: {
  sessionFilePath: string
  cwd: string
  mode: ReplMode
  planPath: string | null
  history: ChatHistory
}) => Promise<void>
type ScheduleBackgroundTask = (task: () => void) => void

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
  historySnapshotBase?: ChatHistory | null
  messages: Msg[]
  engine: Pick<ChatEngine, 'runTurn'>
  cwd: string
  mode: ReplMode
  planPath: string | null
  attemptedSessionIds: Set<string>
  checkedTopicPromptKeys: Set<string>
  model: string
  autoGenerateSessionTitle?: AutoGenerateSessionTitle
  extractAssistantText?: AssistantTextExtractor
  persistRollingMemory?: PersistRollingSessionMemory
  scheduleBackgroundTask?: ScheduleBackgroundTask
}): void {
  if (!args.writer) return
  if (!args.wasLoading || args.isLoading) return

  const { uiMsgCount, firstUserPrompt, lastUserPrompt } = collectUiStatsForTurnCompletion(args.messages)
  const historySnapshot = args.historySnapshotBase
    ? buildSessionReplayHistoryWithActiveContinuation({
        replayHistory: args.historySnapshotBase,
        activeHistory: args.history,
      })
    : args.history
  void args.writer.appendHistorySnapshot(historySnapshot)
  void args.writer.appendEvent('ui_stats', { uiMsgCount, lastUserPrompt, firstUserPrompt })

  const assistantText = (args.extractAssistantText ?? extractLastAssistantTextFromHistory)(args.history)
  const autoGenerate = args.autoGenerateSessionTitle ?? maybeAutoGenerateSessionTitle
  const persistRollingMemory = args.persistRollingMemory ?? persistRollingSessionMemory
  const scheduleBackgroundTask = args.scheduleBackgroundTask ?? ((task: () => void) => setTimeout(task, 0))

  scheduleBackgroundTask(() => {
    void persistRollingMemory({
      sessionFilePath: args.writer.filePath,
      cwd: args.cwd,
      mode: args.mode,
      planPath: args.planPath,
      history: args.history,
    }).catch(() => null)
  })

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
