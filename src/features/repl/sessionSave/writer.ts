import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { stripEphemeralFromHistory } from './historyStrip'
import type { HistoryStateRecord, SessionEventRecord, SessionMetaRecord, SessionRecord, UiMsgRecord } from './records'
import { getSessionFilePath, getSessionsRoot } from './paths'
import { truncateUtf8WithMarker } from './truncate'
import type { ChatHistory, Msg } from './types'

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024
const SAFE_SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

type SessionWriterOptions = {
  maxLineBytes?: number
}

function isoNow(now: Date = new Date()): string {
  return now.toISOString()
}

function parseRequestedSessionId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Invalid sessionId: expected non-empty string')
  if (!SAFE_SESSION_ID_RE.test(trimmed)) {
    throw new Error('Invalid sessionId: expected letters, numbers, underscore, or dash')
  }
  return trimmed
}

function resolveSessionStartTime(value: string | Date | undefined): Date {
  if (value === undefined) return new Date()
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('Invalid startedAt: expected valid Date')
    return value
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error('Invalid startedAt: expected ISO datetime string')
  return new Date(parsed)
}

function bestEffortGitBranch(cwd: string): string | null {
  try {
    const res = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 200,
      windowsHide: true,
    })
    if (res.status !== 0) return null
    const out = String(res.stdout ?? '').trim()
    if (!out || out === 'HEAD') return null
    return out
  } catch {
    return null
  }
}

function isPersistableMsg(msg: Msg): boolean {
  if (msg.isStreaming) return false
  if (msg.role === 'tool' && msg.toolInfo?.status === 'running') return false
  return true
}

function safeStringify(record: SessionRecord): string {
  return JSON.stringify(record)
}

function cloneMsgForPersistence(msg: Msg): Msg {
  // Avoid mutating live UI state when we truncate oversized records for persistence.
  const toolInfo = msg.toolInfo
    ? {
        ...msg.toolInfo,
        ...(msg.toolInfo.nestedTools
          ? { nestedTools: msg.toolInfo.nestedTools.map((t) => ({ ...t })) }
          : {}),
      }
    : undefined
  return { ...msg, ...(toolInfo ? { toolInfo } : {}) }
}

function cloneHistoryForPersistence(history: ChatHistory): ChatHistory {
  return history.map((msg: any) => {
    if (!msg || typeof msg !== 'object') return msg
    const content = msg.content
    if (!Array.isArray(content)) return { ...msg }
    return { ...msg, content: content.map((b: any) => (b && typeof b === 'object' ? { ...b } : b)) }
  }) as any
}

function truncateMsgInPlace(args: { msg: Msg; maxContentBytes: number }): boolean {
  let didTruncate = false

  if (typeof args.msg.content === 'string') {
    const res = truncateUtf8WithMarker(args.msg.content, args.maxContentBytes)
    if (res.truncated) didTruncate = true
    args.msg.content = res.text
  }

  if (args.msg.role === 'tool' && args.msg.toolInfo) {
    if (typeof args.msg.toolInfo.result === 'string') {
      const res = truncateUtf8WithMarker(args.msg.toolInfo.result, args.maxContentBytes)
      if (res.truncated) didTruncate = true
      args.msg.toolInfo.result = res.text
    }
  }

  return didTruncate
}

function truncateHistoryInPlace(args: { history: ChatHistory; maxTextBytes: number }): boolean {
  let didTruncate = false
  for (const msg of args.history as any[]) {
    if (!msg || typeof msg !== 'object') continue
    if (!Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (!block || typeof block !== 'object') continue
      if ((block as any).type !== 'text') continue
      if (typeof (block as any).text !== 'string') continue
      const res = truncateUtf8WithMarker((block as any).text, args.maxTextBytes)
      if (res.truncated) didTruncate = true
      ;(block as any).text = res.text
    }
  }
  return didTruncate
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function truncateTextValue(value: unknown, maxBytes: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return truncateUtf8WithMarker(value, maxBytes).text
}

function compactInputObjectForEvent(args: {
  input: Record<string, unknown>
  maxEntries: number
  maxStringBytes: number
}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [rawKey, rawValue] of Object.entries(args.input)) {
    if (count >= args.maxEntries) break
    const key = truncateUtf8WithMarker(String(rawKey), 96).text
    if (!key) continue
    if (typeof rawValue === 'string') {
      out[key] = truncateUtf8WithMarker(rawValue, args.maxStringBytes).text
      count += 1
      continue
    }
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean' || rawValue === null) {
      out[key] = rawValue
      count += 1
      continue
    }
    if (Array.isArray(rawValue) || (rawValue && typeof rawValue === 'object')) {
      out[key] = truncateUtf8WithMarker(JSON.stringify(rawValue), args.maxStringBytes).text
      count += 1
      continue
    }
  }
  return out
}

function sanitizeAppToolEventData(args: {
  data: Record<string, unknown>
  maxStringBytes: number
  maxLineBytes: number
  maxLines: number
  dropInput: boolean
}): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args.data }

  const longStringKeys = ['threadId', 'turnId', 'toolUseId', 'toolName', 'phase', 'status', 'summary', 'paramsText', 'line']
  for (const key of longStringKeys) {
    const value = truncateTextValue(next[key], args.maxStringBytes)
    if (value !== undefined) next[key] = value
  }

  if (Array.isArray(next.lines)) {
    const lines = next.lines
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      .slice(0, args.maxLines)
      .map((line) => truncateUtf8WithMarker(line, args.maxLineBytes).text)
    if (lines.length > 0) next.lines = lines
    else delete next.lines
  }

  if (args.dropInput) {
    delete next.input
  } else if (isPlainObject(next.input)) {
    next.input = compactInputObjectForEvent({
      input: next.input,
      maxEntries: 24,
      maxStringBytes: args.maxStringBytes,
    })
  } else {
    delete next.input
  }

  if (typeof next.patchStartLineNumber === 'number' && Number.isFinite(next.patchStartLineNumber)) {
    next.patchStartLineNumber = Math.max(1, Math.floor(next.patchStartLineNumber))
  } else {
    delete next.patchStartLineNumber
  }

  return next
}

function buildEssentialAppToolEventData(data: Record<string, unknown>, maxStringBytes: number): Record<string, unknown> {
  const phaseRaw = truncateTextValue(data.phase, 24)
  const phase = phaseRaw === 'start' || phaseRaw === 'update' || phaseRaw === 'end' ? phaseRaw : 'update'
  const statusRaw = truncateTextValue(data.status, 16)
  const status =
    statusRaw === 'running' || statusRaw === 'completed' || statusRaw === 'error' ? statusRaw : undefined
  const summaryFromData = truncateTextValue(data.summary, maxStringBytes)
  const summary =
    summaryFromData ??
    (phase === 'start' ? 'Tool running' : phase === 'end' ? (status === 'error' ? 'Tool failed' : 'Tool completed') : undefined)

  return {
    ...(truncateTextValue(data.threadId, 96) ? { threadId: truncateTextValue(data.threadId, 96) } : {}),
    ...(truncateTextValue(data.turnId, 96) ? { turnId: truncateTextValue(data.turnId, 96) } : {}),
    ...(truncateTextValue(data.toolUseId, 96) ? { toolUseId: truncateTextValue(data.toolUseId, 96) } : {}),
    ...(truncateTextValue(data.toolName, 80) ? { toolName: truncateTextValue(data.toolName, 80) } : {}),
    phase,
    ...(status ? { status } : {}),
    ...(summary ? { summary } : {}),
    ...(truncateTextValue(data.line, maxStringBytes) ? { line: truncateTextValue(data.line, maxStringBytes) } : {}),
  }
}

function buildAppToolEventTrimCandidates(args: {
  record: SessionEventRecord
  maxLineBytes: number
}): SessionEventRecord[] {
  if (!isPlainObject(args.record.data)) return []

  const medium = sanitizeAppToolEventData({
    data: args.record.data,
    maxStringBytes: Math.max(160, Math.floor(args.maxLineBytes * 0.08)),
    maxLineBytes: Math.max(160, Math.floor(args.maxLineBytes * 0.08)),
    maxLines: 24,
    dropInput: false,
  })
  const aggressive = sanitizeAppToolEventData({
    data: args.record.data,
    maxStringBytes: Math.max(96, Math.floor(args.maxLineBytes * 0.05)),
    maxLineBytes: Math.max(96, Math.floor(args.maxLineBytes * 0.05)),
    maxLines: 8,
    dropInput: true,
  })
  const essential = buildEssentialAppToolEventData(args.record.data, Math.max(80, Math.floor(args.maxLineBytes * 0.04)))

  return [
    { ...args.record, data: medium },
    { ...args.record, data: aggressive },
    { ...args.record, data: essential },
  ]
}

function encodeRecord(record: SessionRecord, maxLineBytes: number): { line: string; truncated: boolean } {
  const tryEncode = (rec: SessionRecord): { json: string; bytes: number } => {
    const json = safeStringify(rec)
    return { json, bytes: Buffer.byteLength(json, 'utf8') }
  }

  let { json, bytes } = tryEncode(record)
  if (bytes <= maxLineBytes) return { line: json + '\n', truncated: false }

  // Ensure we never write invalid JSON. If a record is too large, truncate
  // known-large fields and, as a last resort, drop oldest history items.
  let truncated = false

  if (record.type === 'ui_msg') {
    const rec: UiMsgRecord = { ...record, msg: cloneMsgForPersistence((record as any).msg) }
    // Allocate ~60% of the budget to message text/result; leave room for JSON overhead.
    const budget = Math.max(1, Math.floor(maxLineBytes * 0.6))
    truncated = truncateMsgInPlace({ msg: rec.msg, maxContentBytes: budget })
    rec.truncated = true
    ;({ json, bytes } = tryEncode(rec))
    if (bytes <= maxLineBytes) return { line: json + '\n', truncated: true }
  }

  if (record.type === 'history_state') {
    const rec: HistoryStateRecord = { ...record, messages: cloneHistoryForPersistence((record as any).messages) }
    const perBlockBudget = Math.max(256, Math.floor(maxLineBytes * 0.1))
    truncated = truncateHistoryInPlace({ history: rec.messages, maxTextBytes: perBlockBudget }) || truncated
    rec.truncated = true
    ;({ json, bytes } = tryEncode(rec))
    if (bytes <= maxLineBytes) return { line: json + '\n', truncated: true }

    // Still too large; drop oldest messages until it fits.
    while (rec.messages.length > 0) {
      rec.messages = rec.messages.slice(1)
      ;({ json, bytes } = tryEncode(rec))
      if (bytes <= maxLineBytes) return { line: json + '\n', truncated: true }
    }
  }

  if (record.type === 'event' && record.name === 'app_tool_event') {
    const candidates = buildAppToolEventTrimCandidates({ record, maxLineBytes })
    for (const candidate of candidates) {
      ;({ json, bytes } = tryEncode(candidate))
      if (bytes <= maxLineBytes) return { line: json + '\n', truncated: true }
    }
  }

  // Fallback: emit a small event that we had to drop an oversized record.
  const ev: SessionEventRecord = {
    type: 'event',
    v: 1,
    ts: isoNow(),
    name: 'line_truncated',
    data: { originalType: (record as any).type, maxLineBytes },
  }
  ;({ json } = tryEncode(ev))
  return { line: json + '\n', truncated: true }
}

export class SessionWriter {
  static async createNew(args: {
    cwd: string
    env?: NodeJS.ProcessEnv
    platform?: string
    homedir?: string
    model?: string
    sessionId?: string
    startedAt?: string | Date
    maxLineBytes?: number
  }): Promise<{ writer: SessionWriter; meta: SessionMetaRecord; filePath: string }> {
    const now = resolveSessionStartTime(args.startedAt)
    const sessionId = args.sessionId === undefined ? randomUUID() : parseRequestedSessionId(args.sessionId)
    const sessionsRoot = getSessionsRoot({
      cwd: args.cwd,
      env: args.env,
      platform: args.platform,
      homedir: args.homedir,
    })
    const filePath = getSessionFilePath({ sessionsRoot, now, sessionId })
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    const cwdReal = await fs
      .realpath(args.cwd)
      .catch(() => null)
    const gitBranch = bestEffortGitBranch(args.cwd)

    const meta: SessionMetaRecord = {
      type: 'session_meta',
      v: 1,
      ts: isoNow(now),
      sessionId,
      startedAt: isoNow(now),
      cwd: args.cwd,
      ...(cwdReal ? { cwdReal } : {}),
      ...(gitBranch ? { gitBranch } : {}),
      provider: 'anthropic',
      ...(args.model ? { model: args.model } : {}),
    }

    const maxLineBytes = args.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
    const handle = await fs.open(filePath, 'a', 0o600)
    await fs.chmod(filePath, 0o600).catch(() => undefined)
    const writer = new SessionWriter({ filePath, handle, maxLineBytes })
    await writer.appendRaw(meta)
    return { writer, meta, filePath }
  }

  static async openExisting(args: { filePath: string; maxLineBytes?: number }): Promise<SessionWriter> {
    const handle = await fs.open(args.filePath, 'a', 0o600)
    await fs.chmod(args.filePath, 0o600).catch(() => undefined)
    return new SessionWriter({
      filePath: args.filePath,
      handle,
      maxLineBytes: args.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
    })
  }

  readonly filePath: string
  private readonly handle: fs.FileHandle
  private readonly maxLineBytes: number

  private queue: Array<{ record: SessionRecord; resolve: () => void }> = []
  private draining: Promise<void> | null = null
  private closed = false
  private dropped = 0

  private historySeq = 0

  private constructor(args: { filePath: string; handle: fs.FileHandle; maxLineBytes: number }) {
    this.filePath = args.filePath
    this.handle = args.handle
    this.maxLineBytes = args.maxLineBytes
  }

  getDroppedCount(): number {
    return this.dropped
  }

  enqueue(record: SessionRecord): Promise<void> {
    if (this.closed) return Promise.resolve()

    return new Promise<void>((resolve) => {
      if (this.queue.length > 1000) {
        this.dropped += 1
        resolve()
        return
      }
      this.queue.push({ record, resolve })
      void this.drain()
    })
  }

  async shutdown(): Promise<void> {
    this.closed = true
    await this.drain()
    await this.handle.close().catch(() => undefined)
  }

  async flush(): Promise<void> {
    await this.drain()
  }

  async appendStableMsg(msg: Msg): Promise<void> {
    if (!isPersistableMsg(msg)) return
    const rec: UiMsgRecord = { type: 'ui_msg', v: 1, ts: isoNow(), msg }
    await this.enqueue(rec)
  }

  async appendHistorySnapshot(history: ChatHistory): Promise<void> {
    const stripped = stripEphemeralFromHistory(history)
    const rec: HistoryStateRecord = {
      type: 'history_state',
      v: 1,
      ts: isoNow(),
      seq: (this.historySeq += 1),
      messages: stripped,
    }
    await this.enqueue(rec)
  }

  async appendEvent(name: string, data?: Record<string, unknown>): Promise<void> {
    const rec: SessionEventRecord = { type: 'event', v: 1, ts: isoNow(), name, ...(data ? { data } : {}) }
    await this.enqueue(rec)
  }

  private async appendRaw(record: SessionRecord): Promise<void> {
    const { line } = encodeRecord(record, this.maxLineBytes)
    await this.handle.write(line)
    await this.handle.sync()
  }

  private async drain(): Promise<void> {
    if (this.draining) return this.draining

    this.draining = (async () => {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.queue.length)
        const lines: string[] = []
        for (const item of batch) {
          const { line } = encodeRecord(item.record, this.maxLineBytes)
          lines.push(line)
        }
        if (lines.length) {
          await this.handle.write(lines.join(''))
          await this.handle.sync()
        }
        for (const item of batch) item.resolve()
      }
    })()
      .finally(() => {
        this.draining = null
      })

    return this.draining
  }
}

export function getDefaultMaxLineBytes(): number {
  return DEFAULT_MAX_LINE_BYTES
}

export type { SessionWriterOptions }
