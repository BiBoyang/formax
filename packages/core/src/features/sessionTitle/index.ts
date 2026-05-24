import type { ChatEngine } from '../../chat/engine'
import { readSessionSummary } from '../repl/sessionSave/reader'
import { SessionWriter } from '../repl/sessionSave/writer'
import { persistSessionTitle } from './apply'
import { detectNewTopicTitleCandidate, generateSessionTitle } from './generate'
import { shouldGenerateSessionTitle } from './policy'

export type MaybeAutoGenerateSessionTitleArgs = {
  filePath: string
  engine: Pick<ChatEngine, 'runTurn'>
  cwd: string
  attemptedSessionIds: Set<string>
  checkedTopicPromptKeys?: Set<string>
  writer?: Pick<SessionWriter, 'appendEvent'>
  userText?: string | null
  topicUserText?: string | null
  assistantText?: string | null
  model?: string
  signal?: AbortSignal
}

async function recordAutoTitleAttempt(
  writer: Pick<SessionWriter, 'appendEvent'> | undefined,
  filePath: string | undefined,
  status: 'empty' | 'failed' | 'persist_error',
  detail?: string,
): Promise<void> {
  const data = {
    status,
    ...(detail ? { detail } : {}),
  }
  if (writer) {
    await writer.appendEvent('auto_title_attempt', data)
    return
  }
  if (!filePath) return
  const opened = await SessionWriter.openExisting({ filePath })
  try {
    await opened.appendEvent('auto_title_attempt', data)
    await opened.flush()
  } finally {
    await opened.shutdown()
  }
}

function isAbortLikeError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (!error || typeof error !== 'object') return false
  const err = error as { name?: unknown }
  return err.name === 'AbortError'
}

export async function maybeAutoGenerateSessionTitle(args: MaybeAutoGenerateSessionTitleArgs): Promise<string | null> {
  const summary = await readSessionSummary(args.filePath)
  const sessionId = summary.meta.sessionId
  const candidateUserText = String(args.userText ?? summary.lastUserPrompt ?? '').trim() || null
  const hasLabel = Boolean(summary.label)

  const shouldRun = shouldGenerateSessionTitle({
    hasLabel,
    titleSource: summary.titleSource,
    candidateUserText,
    messageCount: summary.messageCount,
    failedAttemptCount: summary.autoTitleAttemptCount,
    attemptedInProcess: args.attemptedSessionIds.has(sessionId),
  })

  if (!shouldRun || !candidateUserText) return null

  args.attemptedSessionIds.add(sessionId)
  try {
    const generated = await generateSessionTitle({
      engine: args.engine,
      cwd: args.cwd,
      userText: candidateUserText,
      assistantText: args.assistantText,
      model: args.model,
      signal: args.signal,
    })
    if (!generated) {
      await recordAutoTitleAttempt(args.writer, args.filePath, 'empty').catch(() => undefined)
      args.attemptedSessionIds.delete(sessionId)
      return null
    }

    try {
      await persistSessionTitle({
        label: generated,
        filePath: args.filePath,
        writer: args.writer,
      })
    } catch (error) {
      await recordAutoTitleAttempt(
        args.writer,
        args.filePath,
        'persist_error',
        error instanceof Error ? error.message : String(error),
      ).catch(() => undefined)
      args.attemptedSessionIds.delete(sessionId)
      return null
    }
    return generated
  } catch (error) {
    if (!isAbortLikeError(error, args.signal)) {
      await recordAutoTitleAttempt(
        args.writer,
        args.filePath,
        'failed',
        error instanceof Error ? error.message : String(error),
      ).catch(() => undefined)
    }
    args.attemptedSessionIds.delete(sessionId)
    if (isAbortLikeError(error, args.signal)) throw error
    return null
  }
}

export {
  detectNewTopicTitleCandidate,
  extractLastAssistantTextFromHistory,
  generateSessionTitle,
  normalizeSessionTitle,
} from './generate'
export { shouldGenerateSessionTitle } from './policy'
