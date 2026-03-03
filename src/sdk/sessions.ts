import path from 'node:path'
import {
  listRecentSessions,
  readSessionFile,
} from '../features/repl/sessionSave/reader.js'
import type { PromptMessage } from '../prompts/index.js'
import type {
  GetSessionMessagesOptions,
  ListSessionsOptions,
  SDKSessionInfo,
  SessionMessage,
} from './types.js'
import {
  asValidationError,
  parseGetSessionMessagesOptionsInput,
  parseListSessionsOptionsInput,
  parseRawSessionReplayOutput,
  parseRawSessionSummaryListOutput,
  parseSDKSessionInfoListOutput,
  parseSessionIdInput,
  parseSessionMessageListOutput,
} from './validation.js'

function resolveLookupCwd(dir?: string): string {
  return path.resolve(dir ?? process.cwd())
}

const SESSION_LOOKUP_LIMIT = 800

function toSDKSessionInfo(summary: {
  meta: { sessionId: string; cwd: string; gitBranch?: string }
  updatedAt: Date
  lastUserPrompt: string | null
  label: string | null
}): SDKSessionInfo {
  const promptSummary = summary.lastUserPrompt?.trim() ?? ''
  const label = summary.label?.trim() ?? ''
  const title = label || promptSummary
  const out: SDKSessionInfo = {
    sessionId: summary.meta.sessionId,
    summary: title,
    lastModified: summary.updatedAt.getTime(),
    // Current session reader does not provide file size directly.
    fileSize: 0,
  }

  if (label) out.customTitle = label
  if (summary.meta.gitBranch) out.gitBranch = summary.meta.gitBranch
  if (summary.meta.cwd) out.cwd = summary.meta.cwd
  return out
}

function toSessionMessage(args: {
  sessionId: string
  message: PromptMessage
  index: number
}): SessionMessage {
  return {
    type: args.message.role,
    uuid: `${args.sessionId}:${args.index + 1}`,
    session_id: args.sessionId,
    message: args.message,
    parent_tool_use_id: null,
  }
}

export async function listSessions(options: ListSessionsOptions = {}): Promise<SDKSessionInfo[]> {
  let parsedOptions: ListSessionsOptions
  try {
    parsedOptions = parseListSessionsOptionsInput(options)
  } catch (error) {
    throw asValidationError(error, 'Invalid listSessions options')
  }

  const cwd = resolveLookupCwd(parsedOptions.dir)
  let rawSummaries: unknown
  try {
    rawSummaries = await listRecentSessions({
      cwd,
      ...(parsedOptions.limit !== undefined ? { limit: parsedOptions.limit } : {}),
    })
  } catch (error) {
    throw asValidationError(error, 'Failed to list sessions')
  }

  try {
    const parsedSummaries = parseRawSessionSummaryListOutput(rawSummaries)
    const mapped = parsedSummaries.map((summary) => toSDKSessionInfo(summary))
    return parseSDKSessionInfoListOutput(mapped)
  } catch (error) {
    throw asValidationError(error, 'Invalid listSessions output')
  }
}

export async function getSessionMessages(
  sessionId: string,
  options: GetSessionMessagesOptions = {},
): Promise<SessionMessage[]> {
  let parsedSessionId: string
  let parsedOptions: GetSessionMessagesOptions
  try {
    parsedSessionId = parseSessionIdInput(sessionId)
    parsedOptions = parseGetSessionMessagesOptionsInput(options)
  } catch (error) {
    throw asValidationError(error, 'Invalid getSessionMessages options')
  }

  const cwd = resolveLookupCwd(parsedOptions.dir)
  let rawSummaries: unknown
  try {
    rawSummaries = await listRecentSessions({
      cwd,
      limit: SESSION_LOOKUP_LIMIT,
    })
  } catch (error) {
    throw asValidationError(error, 'Failed to list sessions')
  }

  let filePath: string | null = null
  try {
    const summaries = parseRawSessionSummaryListOutput(rawSummaries)
    const matched = summaries.find((summary) => summary.meta.sessionId === parsedSessionId)
    filePath = matched?.filePath ?? null
  } catch (error) {
    throw asValidationError(error, 'Invalid getSessionMessages output')
  }

  if (filePath === null) {
    throw new Error(`Session ${parsedSessionId} not found`)
  }

  let rawReplay: unknown
  try {
    rawReplay = await readSessionFile(filePath)
  } catch (error) {
    throw asValidationError(error, 'Failed to read session file')
  }

  try {
    const replay = parseRawSessionReplayOutput(rawReplay)
    const offset = parsedOptions.offset ?? 0
    const end = parsedOptions.limit !== undefined ? offset + parsedOptions.limit : undefined
    const selectedHistory = replay.history.slice(offset, end)
    const mapped = selectedHistory.map((message, index) =>
      toSessionMessage({
        sessionId: replay.sessionId,
        message,
        index: offset + index,
      }),
    )
    return parseSessionMessageListOutput(mapped)
  } catch (error) {
    throw asValidationError(error, 'Invalid getSessionMessages output')
  }
}
