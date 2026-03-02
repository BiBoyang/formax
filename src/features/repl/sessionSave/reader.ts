import fs from 'node:fs'
import fsp from 'node:fs/promises'
import readline from 'node:readline'
import path from 'node:path'
import { formatToolResult } from '../../../shared/utils/toolFormatting'
import {
  createPersistedToolEventAggregator,
  type PersistedToolMessage,
} from './persistedToolEvents'
import type { HistoryStateRecord, SessionMetaRecord, SessionRecord, UiMsgRecord } from './records'
import { getArchivedSessionsRoot, getSessionsRoot } from './paths'
import type { ChatHistory, Msg } from './types'

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

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value) && Object.keys(value).length > 0
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function detailLinesFromPersistedTool(args: { summary: string; detailLines: string[] }): string[] {
  if (args.detailLines.length === 0) return []
  if (args.detailLines[0] === args.summary) return args.detailLines.slice(1)
  return args.detailLines
}

function isSearchLikeToolName(toolName: string): boolean {
  return toolName === 'Glob' || toolName === 'Grep' || toolName === 'Search'
}

function hasCompactReadSummary(summary: string): boolean {
  return /^Read\s+\d+\s+lines$/.test(summary.trim())
}

function hasCompactSearchSummary(args: { toolName: string; summary: string }): boolean {
  const summary = args.summary.trim()
  if (!summary) return false
  if (args.toolName === 'Glob' || args.toolName === 'Search') return /^Found\s+\d+\s+files$/.test(summary)
  if (args.toolName === 'Grep') return /^Found\s+\d+\s+(matches|files|lines)$/.test(summary)
  return false
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
  if (args.status === 'running') {
    return {
      summary: args.summary,
      middleLines: defaultMiddleLines,
      rawResult: defaultRawResult,
    }
  }

  if (args.toolName === 'Read') {
    if (hasCompactReadSummary(args.summary)) {
      return {
        summary: args.summary,
        middleLines: [],
        rawResult: defaultRawResult,
      }
    }
    return {
      summary: args.summary,
      middleLines: defaultMiddleLines,
      rawResult: defaultRawResult,
    }
  }

  if (!isSearchLikeToolName(args.toolName)) {
    return {
      summary: args.summary,
      middleLines: defaultMiddleLines,
      rawResult: defaultRawResult,
    }
  }

  if (hasCompactSearchSummary({ toolName: args.toolName, summary: args.summary })) {
    return {
      summary: args.summary,
      middleLines: [],
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

function toToolMsgFromPersisted(args: { tool: PersistedToolMessage; fallbackTimestamp: Date }): Msg {
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

function reviveMsg(raw: Msg, recordTimestamp?: string): Msg {
  const recordDate = typeof recordTimestamp === 'string' ? new Date(recordTimestamp) : null
  const rowDate = new Date((raw as any).timestamp)
  const timestamp =
    recordDate && Number.isFinite(recordDate.getTime())
      ? recordDate
      : Number.isFinite(rowDate.getTime())
        ? rowDate
        : new Date(0)
  return { ...raw, timestamp }
}

function reviveHistory(history: ChatHistory): ChatHistory {
  return history
}

function mergeLegacyToolFieldsIntoPersisted(args: { persisted: Msg; legacy: Msg }): Msg {
  if (args.persisted.role !== 'tool' || args.legacy.role !== 'tool') return args.persisted
  const persistedToolInfo = args.persisted.toolInfo
  const legacyToolInfo = args.legacy.toolInfo
  if (!persistedToolInfo || !legacyToolInfo) return args.persisted

  const mergedInput =
    isNonEmptyRecord(persistedToolInfo.input) || !isNonEmptyRecord(legacyToolInfo.input)
      ? persistedToolInfo.input
      : legacyToolInfo.input
  const mergedResult =
    typeof persistedToolInfo.result === 'string' && persistedToolInfo.result.trim().length > 0
      ? persistedToolInfo.result
      : legacyToolInfo.result
  const mergedMiddleLines =
    Array.isArray(persistedToolInfo.middleLines) && persistedToolInfo.middleLines.length > 0
      ? persistedToolInfo.middleLines
      : legacyToolInfo.middleLines
  const mergedPatchStartLineNumber =
    typeof persistedToolInfo.patchStartLineNumber === 'number' &&
    Number.isFinite(persistedToolInfo.patchStartLineNumber) &&
    persistedToolInfo.patchStartLineNumber > 0
      ? Math.floor(persistedToolInfo.patchStartLineNumber)
      : typeof legacyToolInfo.patchStartLineNumber === 'number' &&
          Number.isFinite(legacyToolInfo.patchStartLineNumber) &&
          legacyToolInfo.patchStartLineNumber > 0
        ? Math.floor(legacyToolInfo.patchStartLineNumber)
        : undefined

  const mergedToolInfo = {
    ...persistedToolInfo,
    ...(mergedInput !== undefined ? { input: mergedInput } : {}),
    ...(mergedResult !== undefined ? { result: mergedResult } : {}),
    ...(mergedMiddleLines !== undefined ? { middleLines: mergedMiddleLines } : {}),
    ...(mergedPatchStartLineNumber !== undefined ? { patchStartLineNumber: mergedPatchStartLineNumber } : {}),
  }

  const mergedContent =
    (typeof args.persisted.content === 'string' && args.persisted.content.trim().length > 0
      ? args.persisted.content
      : args.legacy.content) ?? args.persisted.content

  return {
    ...args.persisted,
    ...(typeof mergedContent === 'string' ? { content: mergedContent } : {}),
    toolInfo: mergedToolInfo,
  }
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
  const uiToolById = new Map<string, Msg>()
  const persistedToolAggregator = createPersistedToolEventAggregator()
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
      const revived = reviveMsg(rec.msg, rec.ts)
      if (revived.role === 'tool') {
        uiToolById.set(revived.id, revived)
        continue
      }
      msgById.set(revived.id, revived)
      continue
    }
    if (type === 'history_state') {
      lastHistory = parsed as HistoryStateRecord
      continue
    }

    if (type === 'event') {
      const name = coerceNonEmptyString(parsed.name)
      if (name !== 'app_tool_event') continue
      persistedToolAggregator.ingest({
        ts: parsed.ts,
        data: parsed.data,
      })
    }
  }

  if (!meta) {
    throw new Error(`Invalid session file (missing session_meta): ${filePath}`)
  }

  const persistedTools = persistedToolAggregator.finalize()
  const persistedTerminalToolUseIds = new Set<string>()
  const persistedMessageIdByToolUseId = new Map<string, string>()
  if (persistedTools.length > 0) {
    const fallbackTimestamp = new Date(meta.startedAt)
    for (const persistedTool of persistedTools) {
      const nextMsg = toToolMsgFromPersisted({
        tool: persistedTool,
        fallbackTimestamp,
      })
      if (persistedTool.toolUseId) {
        persistedMessageIdByToolUseId.set(persistedTool.toolUseId, nextMsg.id)
        if (persistedTool.status === 'completed' || persistedTool.status === 'error') {
          persistedTerminalToolUseIds.add(persistedTool.toolUseId)
        }
      }
      msgById.set(nextMsg.id, nextMsg)
    }
  }

  for (const toolMsg of uiToolById.values()) {
    const toolUseId = coerceNonEmptyString(toolMsg.toolInfo?.toolUseId)
    if (toolUseId) {
      const persistedMsgId = persistedMessageIdByToolUseId.get(toolUseId)
      if (persistedMsgId) {
        const persistedMsg = msgById.get(persistedMsgId)
        if (persistedMsg && persistedTerminalToolUseIds.has(toolUseId)) {
          msgById.set(
            persistedMsgId,
            mergeLegacyToolFieldsIntoPersisted({
              persisted: persistedMsg,
              legacy: toolMsg,
            }),
          )
          continue
        }
        msgById.delete(persistedMsgId)
      }
    }
    if (msgById.has(toolMsg.id)) continue
    msgById.set(toolMsg.id, toolMsg)
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
  latestTurnCwd: string | null
}> {
  const tail = await readTailText(filePath, 256 * 1024).catch(() => '')
  if (!tail) return { messageCount: null, lastUserPrompt: null, label: null, latestTurnCwd: null }

  let messageCount: number | null = null
  let titleSeedPrompt: string | null = null
  let label: string | null = null
  let latestTurnCwd: string | null = null

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
      if (messageCount !== null && titleSeedPrompt && label && latestTurnCwd) break
      continue
    }

    if (name === 'app_turn_started' && !latestTurnCwd) {
      latestTurnCwd = coerceString((data as any).cwd)
      if (messageCount !== null && titleSeedPrompt && label && latestTurnCwd) break
      continue
    }

    if (name === 'ui_stats') {
      if (messageCount === null) messageCount = coerceNumber((data as any).uiMsgCount)
      if (!titleSeedPrompt) {
        titleSeedPrompt =
          coerceString((data as any).firstUserPrompt) ??
          coerceString((data as any).lastUserPrompt)
      }
      if (messageCount !== null && titleSeedPrompt && label && latestTurnCwd) break
    }
  }

  return { messageCount, lastUserPrompt: titleSeedPrompt, label, latestTurnCwd }
}

export async function readSessionSummary(filePath: string): Promise<SessionSummary> {
  const [meta, stat, tail] = await Promise.all([
    readSessionMetaOnly(filePath),
    fsp.stat(filePath),
    readTailSummaryData(filePath),
  ])
  const summaryMeta =
    tail.latestTurnCwd && tail.latestTurnCwd !== meta.cwd
      ? await (async () => {
          const { cwdReal: _ignoredCwdReal, ...rest } = meta
          const latestTurnCwdReal = await fsp.realpath(tail.latestTurnCwd!).catch(() => null)
          return {
            ...rest,
            cwd: tail.latestTurnCwd!,
            ...(latestTurnCwdReal ? { cwdReal: latestTurnCwdReal } : {}),
          }
        })()
      : meta

  return {
    filePath,
    meta: summaryMeta,
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

export const __readerTestOnly = {
  isObject,
  isNonEmptyRecord,
  coerceNonEmptyString,
  detailLinesFromPersistedTool,
  isSearchLikeToolName,
  hasCompactReadSummary,
  hasCompactSearchSummary,
  normalizePersistedToolDisplay,
  toToolMsgFromPersisted,
  reviveMsg,
  mergeLegacyToolFieldsIntoPersisted,
  collectSessionCandidates,
  readSessionMetaOnly,
  readTailText,
  coerceString,
  coerceNumber,
  readTailSummaryData,
  toSingleLinePreview,
}
