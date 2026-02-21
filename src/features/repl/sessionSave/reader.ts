import fs from 'node:fs'
import fsp from 'node:fs/promises'
import readline from 'node:readline'
import path from 'node:path'
import type { ChatHistory } from '../../../chat/engine'
import type { Msg } from '../../../components/tool/ToolMessage'
import { formatToolResult } from '../../../utils/toolFormatting'
import type { HistoryStateRecord, SessionMetaRecord, SessionRecord, UiMsgRecord } from './records'
import { getArchivedSessionsRoot, getSessionsRoot } from './paths'

export type SessionReplay = {
  meta: SessionMetaRecord
  messages: Msg[]
  history: ChatHistory
  parseErrors: number
}

export type SessionSummary = {
  filePath: string
  meta: SessionMetaRecord
  updatedAt: Date
  messageCount: number | null
  lastUserPrompt: string | null
  label: string | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

type PersistedToolReplayMessage = {
  id: string
  occurredAtMs: number
  sequence: number
  toolUseId?: string
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  input?: Record<string, unknown>
  patchStartLineNumber?: number
  paramsText?: string
  detailLines: string[]
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseTimestampMs(value: unknown): number {
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseToolStatus(value: unknown): 'running' | 'completed' | 'error' | null {
  if (value === 'running' || value === 'completed' || value === 'error') return value
  return null
}

function parseInputObject(value: unknown): Record<string, unknown> | undefined {
  if (!isObject(value) || Array.isArray(value)) return undefined
  return value
}

function parseNonEmptyInputObject(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseInputObject(value)
  if (!parsed) return undefined
  return Object.keys(parsed).length > 0 ? parsed : undefined
}

function parsePatchStartLineNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value <= 0) return undefined
  return Math.floor(value)
}

function parseLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const lines: string[] = []
  for (const line of value) {
    if (typeof line !== 'string') continue
    const trimmed = line.trim()
    if (!trimmed) continue
    lines.push(trimmed)
  }
  return lines
}

function appendUniqueLine(lines: string[], line: string): void {
  const normalized = line.trim()
  if (!normalized) return
  if (lines[lines.length - 1] === normalized) return
  lines.push(normalized)
}

function detailLinesFromPersistedTool(args: { summary: string; detailLines: string[] }): string[] {
  if (args.detailLines.length === 0) return []
  if (args.detailLines[0] === args.summary) return args.detailLines.slice(1)
  return args.detailLines
}

function isSearchLikeToolName(toolName: string): boolean {
  return toolName === 'Glob' || toolName === 'Grep' || toolName === 'Search'
}

function normalizePersistedToolDisplay(args: {
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  detailLines: string[]
}): {
  summary: string
  middleLines: string[]
  rawResult: string
} {
  const defaultMiddleLines = detailLinesFromPersistedTool({
    summary: args.summary,
    detailLines: args.detailLines,
  })
  const defaultRawResult = args.detailLines.length > 0 ? args.detailLines.join('\n') : defaultMiddleLines.join('\n')
  if (!isSearchLikeToolName(args.toolName) || args.status === 'running') {
    return {
      summary: args.summary,
      middleLines: defaultMiddleLines,
      rawResult: defaultRawResult,
    }
  }

  const rawSearchResult = args.detailLines.length > 0 ? args.detailLines.join('\n') : args.summary
  const formatted = formatToolResult(args.toolName, rawSearchResult, args.status === 'error')
  return {
    summary: formatted.summary || args.summary,
    middleLines: Array.isArray(formatted.middleLines) ? formatted.middleLines : [],
    rawResult: rawSearchResult,
  }
}

function toToolMsgFromPersisted(args: { tool: PersistedToolReplayMessage; fallbackTimestamp: Date }): Msg {
  const timestamp = args.tool.occurredAtMs > 0 ? new Date(args.tool.occurredAtMs) : args.fallbackTimestamp
  const display = normalizePersistedToolDisplay({
    toolName: args.tool.toolName,
    status: args.tool.status,
    summary: args.tool.summary,
    detailLines: args.tool.detailLines,
  })
  return {
    id: args.tool.id,
    role: 'tool',
    content: display.summary,
    timestamp,
    toolInfo: {
      name: args.tool.toolName,
      ...(args.tool.toolUseId ? { toolUseId: args.tool.toolUseId } : {}),
      input: args.tool.input ?? {},
      status: args.tool.status,
      ...(display.middleLines.length > 0 ? { middleLines: display.middleLines } : {}),
      ...(display.rawResult ? { result: display.rawResult } : {}),
      ...(args.tool.patchStartLineNumber !== undefined ? { patchStartLineNumber: args.tool.patchStartLineNumber } : {}),
    },
  }
}

function mergeUiMsgWithPersistedTool(args: {
  uiMsg: Msg
  tool: PersistedToolReplayMessage
  fallbackTimestamp: Date
}): Msg {
  const timestamp =
    args.uiMsg.timestamp instanceof Date
      ? args.uiMsg.timestamp
      : args.tool.occurredAtMs > 0
        ? new Date(args.tool.occurredAtMs)
        : args.fallbackTimestamp
  const existingToolInfo = args.uiMsg.toolInfo
  const display = normalizePersistedToolDisplay({
    toolName: args.tool.toolName,
    status: args.tool.status,
    summary: args.tool.summary,
    detailLines: args.tool.detailLines,
  })
  const existingMiddleLines = Array.isArray(existingToolInfo?.middleLines)
    ? existingToolInfo.middleLines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    : []
  const mergedMiddleLines = existingMiddleLines.length > 0 ? existingMiddleLines : display.middleLines
  const existingResult = typeof existingToolInfo?.result === 'string' ? existingToolInfo.result : ''
  const nextResult =
    existingResult.length > 0
      ? existingResult
      : display.rawResult
  const existingContent = typeof args.uiMsg.content === 'string' ? args.uiMsg.content.trim() : ''

  return {
    ...args.uiMsg,
    role: 'tool',
    content: existingContent || display.summary,
    timestamp,
    toolInfo: {
      name: args.tool.toolName,
      ...(args.tool.toolUseId ? { toolUseId: args.tool.toolUseId } : {}),
      input: parseNonEmptyInputObject(existingToolInfo?.input) ?? parseNonEmptyInputObject(args.tool.input) ?? {},
      status: args.tool.status,
      ...(mergedMiddleLines.length > 0 ? { middleLines: mergedMiddleLines } : {}),
      ...(nextResult ? { result: nextResult } : {}),
      ...(existingToolInfo?.patchStartLineNumber !== undefined
        ? { patchStartLineNumber: existingToolInfo.patchStartLineNumber }
        : args.tool.patchStartLineNumber !== undefined
          ? { patchStartLineNumber: args.tool.patchStartLineNumber }
          : {}),
    },
  }
}

function reviveMsg(raw: Msg): Msg {
  return { ...raw, timestamp: new Date((raw as any).timestamp) }
}

function reviveHistory(history: ChatHistory): ChatHistory {
  return history
}

async function collectSessionCandidates(args: { root: string; archived: boolean }): Promise<string[]> {
  const candidates: string[] = []
  if (args.archived) {
    const entries = await fsp.readdir(args.root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        candidates.push(path.join(args.root, entry.name))
        continue
      }
      if (!entry.isDirectory()) continue
      const yearDir = path.join(args.root, entry.name)
      const months = await fsp.readdir(yearDir, { withFileTypes: true }).catch(() => [])
      for (const m of months) {
        if (!m.isDirectory()) continue
        const monthDir = path.join(yearDir, m.name)
        const days = await fsp.readdir(monthDir, { withFileTypes: true }).catch(() => [])
        for (const d of days) {
          if (!d.isDirectory()) continue
          const dayDir = path.join(monthDir, d.name)
          const files = await fsp.readdir(dayDir, { withFileTypes: true }).catch(() => [])
          for (const f of files) {
            if (!f.isFile()) continue
            if (!f.name.endsWith('.jsonl')) continue
            candidates.push(path.join(dayDir, f.name))
          }
        }
      }
    }
    return candidates
  }

  const years = await fsp.readdir(args.root, { withFileTypes: true }).catch(() => [])
  for (const y of years) {
    if (!y.isDirectory()) continue
    const yearDir = path.join(args.root, y.name)
    const months = await fsp.readdir(yearDir, { withFileTypes: true }).catch(() => [])
    for (const m of months) {
      if (!m.isDirectory()) continue
      const monthDir = path.join(yearDir, m.name)
      const days = await fsp.readdir(monthDir, { withFileTypes: true }).catch(() => [])
      for (const d of days) {
        if (!d.isDirectory()) continue
        const dayDir = path.join(monthDir, d.name)
        const files = await fsp.readdir(dayDir, { withFileTypes: true }).catch(() => [])
        for (const f of files) {
          if (!f.isFile()) continue
          if (!f.name.endsWith('.jsonl')) continue
          candidates.push(path.join(dayDir, f.name))
        }
      }
    }
  }
  return candidates
}

export async function readSessionFile(filePath: string): Promise<SessionReplay> {
  let meta: SessionMetaRecord | null = null
  let lastHistory: HistoryStateRecord | null = null
  const msgById = new Map<string, Msg>()
  const toolByKey = new Map<string, PersistedToolReplayMessage>()
  const activeAnonymousKeyByBucket = new Map<string, string>()
  let toolSequence = 0
  let parseErrors = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = String(line ?? '').trimEnd()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      parseErrors += 1
      continue
    }

    if (!isObject(parsed)) continue
    const type = parsed.type
    if (type === 'session_meta') {
      meta = parsed as SessionMetaRecord
      continue
    }
    if (type === 'ui_msg') {
      const rec = parsed as UiMsgRecord
      if (!rec.msg?.id) continue
      msgById.set(rec.msg.id, reviveMsg(rec.msg))
      continue
    }
    if (type === 'history_state') {
      lastHistory = parsed as HistoryStateRecord
      continue
    }

    if (type === 'event') {
      const name = coerceNonEmptyString(parsed.name)
      if (name !== 'app_tool_event') continue
      const data = isObject(parsed.data) ? parsed.data : null
      if (!data) continue

      const toolUseId = coerceNonEmptyString(data.toolUseId) ?? undefined
      const turnId = coerceNonEmptyString(data.turnId) ?? 'turn'
      const parsedToolName = coerceNonEmptyString(data.toolName)
      const toolName = parsedToolName ?? 'Tool'
      const phase = coerceNonEmptyString(data.phase)
      const bucketKey = `${turnId}:${toolName}`

      let key: string
      if (toolUseId) {
        key = toolUseId
      } else {
        if (phase === 'start' || !activeAnonymousKeyByBucket.has(bucketKey)) {
          activeAnonymousKeyByBucket.set(bucketKey, `anon:${bucketKey}:${toolSequence}`)
        }
        key = activeAnonymousKeyByBucket.get(bucketKey) ?? `anon:${bucketKey}:${toolSequence}`
      }

      const ts = parseTimestampMs(parsed.ts)
      const summary = coerceNonEmptyString(data.summary)
      const input = parseInputObject(data.input)
      const patchStartLineNumber = parsePatchStartLineNumber(data.patchStartLineNumber)
      const paramsText = coerceNonEmptyString(data.paramsText) ?? undefined
      const status = parseToolStatus(data.status)
      const lineValue = coerceNonEmptyString(data.line)
      const linesValue = parseLines(data.lines)

      let current = toolByKey.get(key)
      if (!current) {
        current = {
          id: `tool-${key}`,
          occurredAtMs: ts,
          sequence: toolSequence,
          ...(toolUseId ? { toolUseId } : {}),
          toolName,
          status: status ?? 'running',
          summary: summary ?? `${toolName} running`,
          ...(input ? { input } : {}),
          ...(patchStartLineNumber !== undefined ? { patchStartLineNumber } : {}),
          ...(paramsText ? { paramsText } : {}),
          detailLines: [],
        }
        toolByKey.set(key, current)
      }

      if (parsedToolName) current.toolName = parsedToolName
      if (status) current.status = status
      if (summary) current.summary = summary
      if (input) current.input = input
      if (patchStartLineNumber !== undefined) current.patchStartLineNumber = patchStartLineNumber
      if (paramsText) current.paramsText = paramsText
      if (lineValue) appendUniqueLine(current.detailLines, lineValue)
      for (const detailLine of linesValue) appendUniqueLine(current.detailLines, detailLine)
      if (current.occurredAtMs === 0 && ts > 0) current.occurredAtMs = ts

      const terminal = phase === 'end' || status === 'completed' || status === 'error'
      if (!toolUseId && terminal) {
        activeAnonymousKeyByBucket.delete(bucketKey)
      }
      toolSequence += 1
    }
  }

  if (!meta) {
    throw new Error(`Invalid session file (missing session_meta): ${filePath}`)
  }

  if (toolByKey.size > 0) {
    const fallbackTimestamp = new Date(meta.startedAt)
    const uiToolByUseId = new Map<string, Msg>()
    for (const msg of msgById.values()) {
      if (msg.role !== 'tool') continue
      const toolUseId = typeof msg.toolInfo?.toolUseId === 'string' ? msg.toolInfo.toolUseId.trim() : ''
      if (!toolUseId) continue
      uiToolByUseId.set(toolUseId, msg)
    }

    const persistedTools = Array.from(toolByKey.values()).sort((a, b) => {
      if (a.occurredAtMs !== b.occurredAtMs) return a.occurredAtMs - b.occurredAtMs
      return a.sequence - b.sequence
    })

    for (const persistedTool of persistedTools) {
      const existing = persistedTool.toolUseId ? uiToolByUseId.get(persistedTool.toolUseId) : null
      if (existing) {
        const merged = mergeUiMsgWithPersistedTool({
          uiMsg: existing,
          tool: persistedTool,
          fallbackTimestamp,
        })
        msgById.set(merged.id, merged)
        continue
      }
      const nextMsg = toToolMsgFromPersisted({
        tool: persistedTool,
        fallbackTimestamp,
      })
      msgById.set(nextMsg.id, nextMsg)
      if (persistedTool.toolUseId) {
        uiToolByUseId.set(persistedTool.toolUseId, nextMsg)
      }
    }
  }

  const messages = Array.from(msgById.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const history = reviveHistory(lastHistory?.messages ?? [])

  return { meta, messages, history, parseErrors }
}

export async function findLatestSessionFile(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
  archived?: boolean
}): Promise<string | null> {
  const sessionsRoot = args.archived ? getArchivedSessionsRoot(args) : getSessionsRoot(args)
  const cwdReal = await fsp.realpath(args.cwd).catch(() => null)
  const candidates = await collectSessionCandidates({ root: sessionsRoot, archived: Boolean(args.archived) })

  candidates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))

  for (const filePath of candidates) {
    try {
      const meta = await readSessionMetaOnly(filePath)
      if (cwdReal && meta.cwdReal) {
        if (meta.cwdReal === cwdReal) return filePath
        continue
      }
      if (meta.cwd === args.cwd) return filePath
    } catch {
      continue
    }
  }

  return null
}

export async function findSessionFileBySessionId(args: {
  cwd: string
  sessionId: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
  archived?: boolean
}): Promise<string | null> {
  const sessionsRoot = args.archived ? getArchivedSessionsRoot(args) : getSessionsRoot(args)
  const sessionId = String(args.sessionId ?? '').trim()
  if (!sessionId) return null
  const candidates = await collectSessionCandidates({ root: sessionsRoot, archived: Boolean(args.archived) })

  // Newer files first, in case duplicate session ids exist due to manual edits.
  candidates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))

  for (const filePath of candidates) {
    try {
      const meta = await readSessionMetaOnly(filePath)
      if (meta.sessionId === sessionId) return filePath
    } catch {
      continue
    }
  }

  return null
}

async function readSessionMetaOnly(filePath: string): Promise<SessionMetaRecord> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  let meta: SessionMetaRecord | null = null
  try {
    for await (const line of rl) {
      const trimmed = String(line ?? '').trimEnd()
      if (!trimmed) continue
      const parsed = JSON.parse(trimmed) as unknown
      if (!isObject(parsed)) break
      if (parsed.type !== 'session_meta') break
      meta = parsed as SessionMetaRecord
      break
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  if (!meta) throw new Error(`Invalid session file (missing session_meta): ${filePath}`)
  return meta
}

async function readTailText(filePath: string, maxBytes: number): Promise<string> {
  const handle = await fsp.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    const size = stat.size
    if (size <= 0) return ''
    const start = Math.max(0, size - maxBytes)
    const len = size - start
    const buf = Buffer.alloc(len)
    await handle.read(buf, 0, len, start)
    return buf.toString('utf8')
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function coerceString(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  return s ? s : null
}

function coerceNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function readTailSummaryData(filePath: string): Promise<{
  messageCount: number | null
  lastUserPrompt: string | null
  label: string | null
}> {
  const tail = await readTailText(filePath, 256 * 1024).catch(() => '')
  if (!tail) return { messageCount: null, lastUserPrompt: null, label: null }

  let messageCount: number | null = null
  let titleSeedPrompt: string | null = null
  let label: string | null = null

  const lines = tail.split('\n').map((l) => l.trimEnd()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    if (parsed.type !== 'event') continue
    const name = coerceString(parsed.name)
    if (!name) continue
    const data = isObject(parsed.data) ? parsed.data : {}

    if (name === 'session_rename' && !label) {
      label = coerceString((data as any).label)
      if (messageCount !== null && titleSeedPrompt && label) break
      continue
    }
    if (name === 'ui_stats') {
      if (messageCount === null) messageCount = coerceNumber((data as any).uiMsgCount)
      if (!titleSeedPrompt) {
        titleSeedPrompt =
          coerceString((data as any).firstUserPrompt) ??
          coerceString((data as any).lastUserPrompt)
      }
      if (messageCount !== null && titleSeedPrompt && label) break
    }
  }

  return { messageCount, lastUserPrompt: titleSeedPrompt, label }
}

export async function readSessionSummary(filePath: string): Promise<SessionSummary> {
  const [meta, stat, tail] = await Promise.all([
    readSessionMetaOnly(filePath),
    fsp.stat(filePath),
    readTailSummaryData(filePath),
  ])

  return {
    filePath,
    meta,
    updatedAt: stat.mtime,
    messageCount: tail.messageCount,
    lastUserPrompt: tail.lastUserPrompt,
    label: tail.label,
  }
}

export async function listRecentSessions(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  includeAllProjects?: boolean
  limit?: number
  platform?: string
  homedir?: string
  archived?: boolean
}): Promise<SessionSummary[]> {
  const sessionsRoot = args.archived ? getArchivedSessionsRoot(args) : getSessionsRoot(args)
  const cwdReal = await fsp.realpath(args.cwd).catch(() => null)
  const includeAllProjects = Boolean(args.includeAllProjects)
  const limit = args.limit ?? 200
  const candidates = await collectSessionCandidates({ root: sessionsRoot, archived: Boolean(args.archived) })

  candidates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))

  const out: SessionSummary[] = []

  for (const filePath of candidates.slice(0, 800)) {
    try {
      const summary = await readSessionSummary(filePath)

      if (!includeAllProjects) {
        if (cwdReal && summary.meta.cwdReal) {
          if (summary.meta.cwdReal !== cwdReal) continue
        } else if (summary.meta.cwd !== args.cwd) {
          continue
        }
      }

      out.push(summary)
      if (out.length >= limit) break
    } catch {
      continue
    }
  }

  return out
}

function toSingleLinePreview(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized
  return normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…'
}

export async function readSessionPreview(
  filePath: string,
  opts?: { maxMessages?: number; maxBytes?: number; maxCharsPerMessage?: number },
): Promise<Array<{ role: 'user' | 'assistant'; text: string }>> {
  const maxMessages = opts?.maxMessages ?? 6
  const maxBytes = opts?.maxBytes ?? 512 * 1024
  const maxChars = opts?.maxCharsPerMessage ?? 180

  const tail = await readTailText(filePath, maxBytes).catch(() => '')
  if (!tail) return []

  const out: Array<{ role: 'user' | 'assistant'; text: string }> = []
  const lines = tail.split('\n').map((l) => l.trimEnd()).filter(Boolean)

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    if (parsed.type !== 'ui_msg') continue
    const rec = parsed as any
    const msg = rec.msg as any
    if (!msg || typeof msg !== 'object') continue
    if (msg.role !== 'user' && msg.role !== 'assistant') continue
    if (typeof msg.content !== 'string') continue
    const text = toSingleLinePreview(String(msg.content), maxChars)
    if (!text) continue
    out.push({ role: msg.role, text })
    if (out.length >= maxMessages) break
  }

  return out.reverse()
}
