import type { ChatEngine } from '../../chat/engine'
import { readSessionSummary } from '../repl/sessionSave/reader'
import type { SessionWriter } from '../repl/sessionSave/writer'
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

export async function maybeAutoGenerateSessionTitle(args: MaybeAutoGenerateSessionTitleArgs): Promise<string | null> {
  const summary = await readSessionSummary(args.filePath)
  const sessionId = summary.meta.sessionId
  const candidateUserText = String(args.userText ?? summary.lastUserPrompt ?? '').trim() || null
  const topicCandidateUserText = String(args.topicUserText ?? args.userText ?? '').trim() || null
  const hasLabel = Boolean(summary.label)
  const label = String(summary.label ?? '').trim() || null

  const shouldRun = shouldGenerateSessionTitle({
    hasLabel,
    candidateUserText,
    messageCount: summary.messageCount,
    attemptedInProcess: args.attemptedSessionIds.has(sessionId),
  })
  if (hasLabel) {
    if (!topicCandidateUserText) return null
    const topicKey = `${sessionId}:${topicCandidateUserText}`
    const checkedTopicPromptKeys = args.checkedTopicPromptKeys
    if (checkedTopicPromptKeys?.has(topicKey)) return null

    checkedTopicPromptKeys?.add(topicKey)
    const decision = await detectNewTopicTitleCandidate({
      engine: args.engine,
      cwd: args.cwd,
      userText: topicCandidateUserText,
      model: args.model,
      signal: args.signal,
    }).catch((error) => {
      checkedTopicPromptKeys?.delete(topicKey)
      throw error
    })

    if (!decision?.isNewTopic || !decision.title || decision.title === label) return null
    await persistSessionTitle({
      label: decision.title,
      filePath: args.filePath,
      writer: args.writer,
    })
    return decision.title
  }

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
      args.attemptedSessionIds.delete(sessionId)
      return null
    }

    await persistSessionTitle({
      label: generated,
      filePath: args.filePath,
      writer: args.writer,
    })
    return generated
  } catch (error) {
    args.attemptedSessionIds.delete(sessionId)
    throw error
  }
}

export {
  detectNewTopicTitleCandidate,
  extractLastAssistantTextFromHistory,
  generateSessionTitle,
  normalizeSessionTitle,
} from './generate'
export { shouldGenerateSessionTitle } from './policy'
