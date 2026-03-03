import path from 'node:path'
import fsp from 'node:fs/promises'
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
const LIST_SESSIONS_ENRICH_CONCURRENCY = 8
const FIRST_PROMPT_TAIL_BYTES = 256 * 1024

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  const concurrency = Math.max(1, Math.min(limit, items.length))
  let cursor = 0

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}

async function resolveSessionFileSize(filePath: string): Promise<number> {
  const stat = await fsp.stat(filePath)
  const size = Number((stat as { size?: unknown }).size)
  if (!Number.isFinite(size) || size < 0) return 0
  return Math.floor(size)
}

async function readTailText(filePath: string, maxBytes: number): Promise<string> {
  const handle = await fsp.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    const size = Number((stat as { size?: unknown }).size)
    if (!Number.isFinite(size) || size <= 0) return ''
    const start = Math.max(0, size - maxBytes)
    const len = size - start
    const buf = Buffer.alloc(len)
    await handle.read(buf, 0, len, start)
    return buf.toString('utf8')
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function readFirstUserPromptFromTail(tail: string): string | undefined {
  if (!tail) return undefined

  const lines = tail
    .split('\n')
    .map((line) => String(line).trimEnd())
    .filter(Boolean)
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const line = lines[idx]
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const type = (parsed as { type?: unknown }).type
    if (type !== 'event') continue
    const name = (parsed as { name?: unknown }).name
    if (name !== 'ui_stats') continue
    const data = (parsed as { data?: unknown }).data
    if (!data || typeof data !== 'object') continue
    const firstUserPrompt = (data as { firstUserPrompt?: unknown }).firstUserPrompt
    if (typeof firstUserPrompt !== 'string') continue
    const normalized = firstUserPrompt.trim()
    if (normalized) return normalized
  }

  return undefined
}

async function resolveFirstUserPrompt(filePath: string): Promise<string | undefined> {
  const tail = await readTailText(filePath, FIRST_PROMPT_TAIL_BYTES)
  return readFirstUserPromptFromTail(tail)
}

function toBaseSDKSessionInfo(summary: {
  filePath: string
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
    fileSize: 0,
  }

  if (label) out.customTitle = label
  if (summary.meta.gitBranch) out.gitBranch = summary.meta.gitBranch
  if (summary.meta.cwd) out.cwd = summary.meta.cwd
  return out
}

async function enrichSDKSessionInfo(args: {
  summary: {
    filePath: string
    meta: { sessionId: string; cwd: string; gitBranch?: string }
    updatedAt: Date
    lastUserPrompt: string | null
    label: string | null
  }
  base: SDKSessionInfo
}): Promise<SDKSessionInfo> {
  const out: SDKSessionInfo = { ...args.base }
  out.fileSize = await resolveSessionFileSize(args.summary.filePath)
  const firstPrompt = await resolveFirstUserPrompt(args.summary.filePath)
  if (firstPrompt) out.firstPrompt = firstPrompt
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
    const mapped = await mapWithConcurrency(
      parsedSummaries,
      LIST_SESSIONS_ENRICH_CONCURRENCY,
      async (summary) => {
        const base = toBaseSDKSessionInfo(summary)
        try {
          return await enrichSDKSessionInfo({ summary, base })
        } catch {
          // Keep listSessions resilient: one damaged/stale session file should not hide others.
          return base
        }
      },
    )
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
