import {
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

export async function resolveQueryResumeResolution(args: {
  options: QueryOptions
  cwd: string
  env: NodeJS.ProcessEnv
}): Promise<QueryResumeResolution> {
  const resumeSessionId = parseOptionalSessionId(args.options.resume)
  const requestedSessionId = parseOptionalSessionId(args.options.sessionId)

  if (args.options.resumeSessionAt !== undefined) {
    throw new Error(
      `options.resumeSessionAt (${args.options.resumeSessionAt}) is not supported in Formax SDK yet`,
    )
  }

  if (resumeSessionId === null) {
    return {
      sessionId: requestedSessionId,
      history: [],
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

  let rawReplay: unknown
  try {
    rawReplay = await readSessionFile(filePath)
  } catch (error) {
    throw asValidationError(error, `Failed to read resumed session file (${filePath})`)
  }

  try {
    const replay = parseRawSessionReplayOutput(rawReplay)
    return {
      sessionId: requestedSessionId ?? resumeSessionId,
      history: clonePromptHistory(replay.history),
    }
  } catch (error) {
    throw asValidationError(error, `Invalid resumed session data in ${filePath}`)
  }
}
