import {
  findLatestSessionFile,
  findSessionFileBySessionId,
  readSessionFile,
} from '../../features/repl/sessionSave/reader.js'
import type { PromptMessage } from '../../prompts/index.js'
import type { QueryOptions } from '../types.js'
import {
  asValidationError,
  parseRawSessionReplayOutput,
  parseSessionIdInput,
} from '../validation.js'

type QueryResumeResolution = {
  sessionId: string | null
  history: PromptMessage[]
  sessionFilePath: string | null
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

async function loadReplayFromFile(args: { filePath: string; context: string }): Promise<QueryResumeResolution> {
  let rawReplay: unknown
  try {
    rawReplay = await readSessionFile(args.filePath)
  } catch (error) {
    throw asValidationError(error, `Failed to read ${args.context} session file (${args.filePath})`)
  }

  try {
    const replay = parseRawSessionReplayOutput(rawReplay)
    return {
      sessionId: replay.sessionId,
      history: clonePromptHistory(replay.history),
      sessionFilePath: args.filePath,
    }
  } catch (error) {
    throw asValidationError(error, `Invalid ${args.context} session data in ${args.filePath}`)
  }
}

export async function resolveQueryResumeResolution(args: {
  options: QueryOptions
  cwd: string
  env: NodeJS.ProcessEnv
}): Promise<QueryResumeResolution> {
  const resumeSessionId = parseOptionalSessionId(args.options.resume)
  const requestedSessionId = parseOptionalSessionId(args.options.sessionId)
  const continueConversation = args.options.continue === true

  if (args.options.resumeSessionAt !== undefined) {
    throw new Error(
      `options.resumeSessionAt (${args.options.resumeSessionAt}) is not supported in Formax SDK yet`,
    )
  }

  if (continueConversation && resumeSessionId !== null) {
    throw new Error(
      `options.continue (${args.options.continue}) cannot be used with options.resume (${resumeSessionId})`,
    )
  }

  if (continueConversation) {
    if (requestedSessionId !== null) {
      throw new Error(
        `options.sessionId (${requestedSessionId}) conflicts with options.continue (${args.options.continue}) because options.forkSession is not supported in Formax SDK yet`,
      )
    }

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
        sessionId: null,
        history: [],
        sessionFilePath: null,
      }
    }

    return loadReplayFromFile({
      filePath: latestFilePath,
      context: 'continued',
    })
  }

  if (resumeSessionId === null) {
    return {
      sessionId: requestedSessionId,
      history: [],
      sessionFilePath: null,
    }
  }

  if (requestedSessionId !== null && requestedSessionId !== resumeSessionId) {
    throw new Error(
      `options.sessionId (${requestedSessionId}) conflicts with options.resume (${resumeSessionId}) because options.forkSession is not supported in Formax SDK yet`,
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
  })
  return {
    sessionId: requestedSessionId ?? resumeSessionId,
    history: resumed.history,
    sessionFilePath: resumed.sessionFilePath,
  }
}
