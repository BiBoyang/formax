import { isReplMode, type ReplMode } from '@formax/semantics'
export const APP_SERVER_PROTOCOL_VERSION = '0.2'

export type ClientInfo = {
  name: string
  version: string
}

export type InitializeParams = {
  clientInfo?: ClientInfo
}

export type InitializeResult = {
  serverInfo: {
    name: 'formax'
    version: string
  }
  protocolVersion: typeof APP_SERVER_PROTOCOL_VERSION
  serverInstanceId: string
  ui: {
    showContextMeter: boolean
  }
  limits: {
    maxRequestBytes: number
    maxEventBytes: number
    maxPendingInputsPerThread: number
    defaultInputTtlMs: number
    maxInFlightTurnsPerThread: number
  }
}

export type Thread = {
  id: string
  cwd: string
  createdAt: string
  updatedAt: string
}

export type ThreadSummary = Thread & {
  messageCount: number | null
  lastUserPrompt: string | null
  label: string | null
  titleSource?: ThreadTitleSource
  titleStatus?: ThreadTitleStatus
  archivedAt?: string | null
}

export type ThreadTitleSource = 'manual' | 'auto_title' | 'legacy' | null

export type ThreadTitleStatus = 'ready' | 'untitled' | 'auto_retryable' | 'auto_exhausted'

export type ThreadStartParams = {
  cwd?: string
}

export type ThreadByIdParams = {
  threadId: string
}

export type ThreadArchiveParams = ThreadByIdParams & {
  opId?: string
}

export type ThreadRenameParams = {
  threadId: string
  label: string
}

export type ThreadGroupHideParams = {
  cwd: string
}

export type ThreadListParams = {
  limit: number
  cursor?: string
  archived?: boolean
}

export type ThreadMessagesParams = {
  threadId: string
  limit: number
  cursor?: string
}

export type ThreadReplayParams = {
  threadId: string
  after?: number
  limit: number
}

export type TurnStartParams = {
  threadId: string
  input: {
    text: string
  }
  mode?: ReplMode
  cwd?: string
}

export type CommandDispatchParams = {
  threadId: string
  command: string
  mode?: ReplMode
  cwd?: string
}

export type TurnInterruptParams = {
  threadId: string
  turnId: string
}

export type TurnInputSubmitParams = {
  threadId: string
  turnId: string
  inputId: string
  answers: Record<string, string>
  submissionId?: string
  toolUseId?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export function parseInitializeParams(params: unknown): InitializeParams {
  if (params == null) return {}
  if (!isObject(params)) throw new Error('Invalid params: expected object')

  const out: InitializeParams = {}
  if ('clientInfo' in params) {
    const raw = params.clientInfo
    if (!isObject(raw)) throw new Error('Invalid params.clientInfo: expected object')
    const name = String(raw.name ?? '').trim()
    const version = String(raw.version ?? '').trim()
    if (!name) throw new Error('Invalid params.clientInfo.name')
    if (!version) throw new Error('Invalid params.clientInfo.version')
    out.clientInfo = { name, version }
  }

  return out
}

function parseOptionalNonEmptyString(value: unknown, fieldName: string): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') throw new Error(`Invalid ${fieldName}: expected string`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`Invalid ${fieldName}: expected non-empty string`)
  return trimmed
}

function parseRequiredNonEmptyString(value: unknown, fieldName: string): string {
  const parsed = parseOptionalNonEmptyString(value, fieldName)
  if (!parsed) throw new Error(`Invalid ${fieldName}: expected non-empty string`)
  return parsed
}

function parsePositiveInt(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${fieldName}: expected positive integer`)
  }
  return value
}

export function parseThreadStartParams(params: unknown): ThreadStartParams {
  if (params == null) return {}
  if (!isObject(params)) throw new Error('Invalid params: expected object')

  const cwd = parseOptionalNonEmptyString(params.cwd, 'params.cwd')
  return cwd ? { cwd } : {}
}

export function parseThreadByIdParams(params: unknown): ThreadByIdParams {
  if (!isObject(params)) throw new Error('Invalid params: expected object')
  const threadId = parseRequiredNonEmptyString(params.threadId, 'params.threadId')
  return { threadId }
}

export function parseThreadArchiveParams(params: unknown): ThreadArchiveParams {
  if (!isObject(params)) throw new Error('Invalid params: expected object')
  const threadId = parseRequiredNonEmptyString(params.threadId, 'params.threadId')
  const opId = parseOptionalNonEmptyString(params.opId, 'params.opId')
  return opId ? { threadId, opId } : { threadId }
}

export function parseThreadRenameParams(params: unknown): ThreadRenameParams {
  if (!isObject(params)) throw new Error('Invalid params: expected object')
  const threadId = parseRequiredNonEmptyString(params.threadId, 'params.threadId')
  const label = parseRequiredNonEmptyString(params.label, 'params.label')
  return { threadId, label }
}

export function parseThreadGroupHideParams(params: unknown): ThreadGroupHideParams {
  if (!isObject(params)) throw new Error('Invalid params: expected object')
  const cwd = parseRequiredNonEmptyString(params.cwd, 'params.cwd')
  return { cwd }
}

export function parseThreadListParams(params: unknown): ThreadListParams {
  if (params == null) return { limit: 20 }
  if (!isObject(params)) throw new Error('Invalid params: expected object')

  const limit = 'limit' in params ? parsePositiveInt(params.limit, 'params.limit') : 20
  if (limit > 200) throw new Error('Invalid params.limit: max 200')
  const cursor = parseOptionalNonEmptyString(params.cursor, 'params.cursor')
  const archived =
    'archived' in params
      ? (() => {
          if (typeof params.archived !== 'boolean') throw new Error('Invalid params.archived: expected boolean')
          return params.archived
        })()
      : undefined

  return {
    limit,
    ...(cursor ? { cursor } : {}),
    ...(archived !== undefined ? { archived } : {}),
  }
}

export function parseThreadMessagesParams(params: unknown): ThreadMessagesParams {
  if (!isObject(params)) throw new Error('Invalid params: expected object')

  const threadId = parseRequiredNonEmptyString(params.threadId, 'params.threadId')
  const limit = 'limit' in params ? parsePositiveInt(params.limit, 'params.limit') : 50
  if (limit > 200) throw new Error('Invalid params.limit: max 200')
  const cursor = parseOptionalNonEmptyString(params.cursor, 'params.cursor')

  return cursor ? { threadId, limit, cursor } : { threadId, limit }
}

export function parseThreadReplayParams(params: unknown): ThreadReplayParams {
  if (!isObject(params)) throw new Error('Invalid params: expected object')
  const threadId = parseRequiredNonEmptyString(params.threadId, 'params.threadId')
  let after: number | undefined
  if ('after' in params && params.after != null) {
    if (typeof params.after !== 'number' || !Number.isInteger(params.after) || params.after < 0) {
      throw new Error('Invalid params.after: expected non-negative integer')
    }
    after = params.after
  }
  const limit = 'limit' in params ? parsePositiveInt(params.limit, 'params.limit') : 200
  if (limit > 500) throw new Error('Invalid params.limit: max 500')
  return after == null ? { threadId, limit } : { threadId, after, limit }
}

export function parseTurnStartParams(params: unknown): TurnStartParams {
  if (!isObject(params)) throw new Error('Invalid params: expected object')

  const threadId = parseRequiredNonEmptyString(params.threadId, 'params.threadId')
  if (!isObject(params.input)) throw new Error('Invalid params.input: expected object')
  const text = parseRequiredNonEmptyString(params.input.text, 'params.input.text')
  const modeRaw = parseOptionalNonEmptyString(params.mode, 'params.mode')
  const cwd = parseOptionalNonEmptyString(params.cwd, 'params.cwd')

  let mode: TurnStartParams['mode'] | undefined
  if (isReplMode(modeRaw)) {
    mode = modeRaw
  } else if (modeRaw) {
    throw new Error('Invalid params.mode: expected normal|acceptEdits|plan')
  }

  return {
    threadId,
    input: { text },
    ...(mode ? { mode } : {}),
    ...(cwd ? { cwd } : {}),
  }
}

export function parseCommandDispatchParams(params: unknown): CommandDispatchParams {
  if (!isObject(params)) throw new Error('Invalid params: expected object')

  const threadId = parseRequiredNonEmptyString(params.threadId, 'params.threadId')
  const command = parseRequiredNonEmptyString(params.command, 'params.command')
  if (!command.startsWith('/')) {
    throw new Error('Invalid params.command: expected slash command')
  }
  const modeRaw = parseOptionalNonEmptyString(params.mode, 'params.mode')
  const cwd = parseOptionalNonEmptyString(params.cwd, 'params.cwd')

  let mode: CommandDispatchParams['mode'] | undefined
  if (isReplMode(modeRaw)) {
    mode = modeRaw
  } else if (modeRaw) {
    throw new Error('Invalid params.mode: expected normal|acceptEdits|plan')
  }

  return {
    threadId,
    command,
    ...(mode ? { mode } : {}),
    ...(cwd ? { cwd } : {}),
  }
}

export function parseTurnInterruptParams(params: unknown): TurnInterruptParams {
  if (!isObject(params)) throw new Error('Invalid params: expected object')
  const threadId = parseRequiredNonEmptyString(params.threadId, 'params.threadId')
  const turnId = parseRequiredNonEmptyString(params.turnId, 'params.turnId')
  return { threadId, turnId }
}

export function parseTurnInputSubmitParams(params: unknown): TurnInputSubmitParams {
  if (!isObject(params)) throw new Error('Invalid params: expected object')
  const threadId = parseRequiredNonEmptyString(params.threadId, 'params.threadId')
  const turnId = parseRequiredNonEmptyString(params.turnId, 'params.turnId')
  const inputId =
    parseOptionalNonEmptyString(params.inputId, 'params.inputId') ??
    parseRequiredNonEmptyString((params as any).toolUseId, 'params.toolUseId')

  if (!isObject(params.answers)) throw new Error('Invalid params.answers: expected object')
  const answers: Record<string, string> = {}
  for (const [k, v] of Object.entries(params.answers)) {
    answers[String(k)] = String(v)
  }

  const submissionId = parseOptionalNonEmptyString(params.submissionId, 'params.submissionId')
  const toolUseId = parseOptionalNonEmptyString(params.toolUseId, 'params.toolUseId')

  return {
    threadId,
    turnId,
    inputId,
    answers,
    ...(submissionId ? { submissionId } : {}),
    ...(toolUseId ? { toolUseId } : {}),
  }
}
