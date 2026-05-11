import {
  findLatestSessionFile,
  findSessionFileBySessionId,
  readSessionFile,
} from '../../features/repl/sessionSave/reader.js'
import {
  persistSessionMemoryFromHistory,
  resolveSessionMemoryRestoreArtifacts,
} from '../../features/repl/sessionSave/sessionMemoryRefresh.js'
import { buildActiveHistoryFromSessionReplay } from '../../chat/context/compact.js'
import type { PromptBlock, PromptMessage } from '../../prompts/index.js'
import type { QueryOptions } from '../types.js'
import type { ReplMode } from '../../features/repl/mode.js'
import {
  asValidationError,
  parseRawSessionReplayOutput,
  parseSessionIdInput,
} from '../validation.js'

type QueryResumeResolution = {
  sessionId: string | null
  history: PromptMessage[]
  sessionFilePath: string | null
  nextTurnInjectedBlocks: PromptBlock[]
}

function parseOptionalSessionId(value: string | undefined): string | null {
  if (value === undefined) return null
  return parseSessionIdInput(value)
}

function clonePromptHistory(history: PromptMessage[]): PromptMessage[] {
  if (history.length === 0) return []
  return history.map((message) => ({
    ...message,
    content: Array.isArray(message.content) ? [...message.content] : [],
  }))
}

async function loadReplayFromFile(args: {
  filePath: string
  context: string
  cwd: string
  replMode?: ReplMode
  persistSessionMemoryForRestore?: typeof persistSessionMemoryFromHistory
}): Promise<QueryResumeResolution> {
  let rawReplay: unknown
  try {
    rawReplay = await readSessionFile(args.filePath)
  } catch (error) {
    throw asValidationError(error, `Failed to read ${args.context} session file (${args.filePath})`)
  }

  try {
    const replay = parseRawSessionReplayOutput(rawReplay)
    const history = buildActiveHistoryFromSessionReplay(clonePromptHistory(replay.history))
    const restoreArtifacts = await resolveSessionMemoryRestoreArtifacts({
      sessionFilePath: args.filePath,
      fallbackMode: args.replMode ?? 'normal',
      fallbackPlanPath: null,
    })
    await (args.persistSessionMemoryForRestore ?? persistSessionMemoryFromHistory)({
      sessionFilePath: args.filePath,
      cwd: args.cwd,
      mode: restoreArtifacts.mode,
      planPath: restoreArtifacts.planPath,
      history,
    }).catch(() => undefined)
    return {
      sessionId: replay.sessionId,
      history,
      sessionFilePath: args.filePath,
      nextTurnInjectedBlocks: restoreArtifacts.nextTurnInjectedBlocks,
    }
  } catch (error) {
    throw asValidationError(error, `Invalid ${args.context} session data in ${args.filePath}`)
  }
}

export async function resolveQueryResumeResolution(args: {
  options: QueryOptions
  cwd: string
  env: NodeJS.ProcessEnv
  replMode?: ReplMode
  persistSessionMemoryForRestore?: typeof persistSessionMemoryFromHistory
}): Promise<QueryResumeResolution> {
  const resumeSessionId = parseOptionalSessionId(args.options.resume)
  const requestedSessionId = parseOptionalSessionId(args.options.sessionId)
  const continueConversation = args.options.continue === true
  const forkSession = args.options.forkSession === true

  void args.options.resumeSessionAt

  if (continueConversation && resumeSessionId !== null) {
    throw new Error(
      `options.continue (${args.options.continue}) cannot be used with options.resume (${resumeSessionId})`,
    )
  }

  if (continueConversation) {
    let latestFilePath: string | null
    try {
      latestFilePath = await findLatestSessionFile({
        cwd: args.cwd,
        env: args.env,
      })
    } catch (error) {
      throw asValidationError(error, 'Failed to resolve options.continue from local session storage')
    }

    if (!latestFilePath) {
      return {
        sessionId: requestedSessionId,
        history: [],
        sessionFilePath: null,
        nextTurnInjectedBlocks: [],
      }
    }

    const continued = await loadReplayFromFile({
      filePath: latestFilePath,
      context: 'continued',
      cwd: args.cwd,
      replMode: args.replMode,
      persistSessionMemoryForRestore: args.persistSessionMemoryForRestore,
    })

    if (
      requestedSessionId !== null &&
      !forkSession &&
      requestedSessionId !== continued.sessionId
    ) {
      throw new Error(
        `options.sessionId (${requestedSessionId}) conflicts with options.continue (${args.options.continue}); latest session is (${continued.sessionId}) unless options.forkSession is true`,
      )
    }

    return {
      sessionId: forkSession ? requestedSessionId : requestedSessionId ?? continued.sessionId,
      history: continued.history,
      sessionFilePath: forkSession ? null : continued.sessionFilePath,
      nextTurnInjectedBlocks: continued.nextTurnInjectedBlocks,
    }
  }

  if (resumeSessionId === null) {
    return {
      sessionId: requestedSessionId,
      history: [],
      sessionFilePath: null,
      nextTurnInjectedBlocks: [],
    }
  }

  if (requestedSessionId !== null && requestedSessionId !== resumeSessionId && !forkSession) {
    throw new Error(
      `options.sessionId (${requestedSessionId}) conflicts with options.resume (${resumeSessionId}) unless options.forkSession is true`,
    )
  }

  let filePath: string | null
  try {
    filePath = await findSessionFileBySessionId({
      cwd: args.cwd,
      env: args.env,
      sessionId: resumeSessionId,
    })
  } catch (error) {
    throw asValidationError(
      error,
      `Failed to resolve options.resume (${resumeSessionId}) from local session storage`,
    )
  }

  if (!filePath) {
    throw new Error(
      `options.resume (${resumeSessionId}) is not available in local session storage for cwd (${args.cwd})`,
    )
  }

  const resumed = await loadReplayFromFile({
    filePath,
    context: 'resumed',
    cwd: args.cwd,
    replMode: args.replMode,
    persistSessionMemoryForRestore: args.persistSessionMemoryForRestore,
  })
  return {
    sessionId: forkSession ? requestedSessionId : requestedSessionId ?? resumeSessionId,
    history: resumed.history,
    sessionFilePath: forkSession ? null : resumed.sessionFilePath,
    nextTurnInjectedBlocks: resumed.nextTurnInjectedBlocks,
  }
}
