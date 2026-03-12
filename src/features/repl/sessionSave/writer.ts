import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { stripEphemeralFromHistory } from './historyStrip'
import type {
  HistoryStateRecord,
  SessionEventRecord,
  SessionMetaRecord,
  SessionRecord,
  UiMsgRecord,
} from './records'
import { getSessionFilePath, getSessionsRoot } from './paths'
import type { ChatHistory, Msg } from './types'
import {
  buildAppToolEventTrimCandidates,
  buildEssentialAppToolEventData,
  cloneHistoryForPersistence,
  cloneMsgForPersistence,
  compactInputObjectForEvent,
  encodeRecord,
  isPlainObject,
  safeStringify,
  sanitizeAppToolEventData,
  truncateHistoryInPlace,
  truncateMsgInPlace,
  truncateTextValue,
} from './recordEncoding'

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
    const out = String(res.stdout).trim()
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
        await this.handle.write(lines.join(''))
        await this.handle.sync()
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

export const __writerTestOnly = {
  isoNow,
  parseRequestedSessionId,
  resolveSessionStartTime,
  bestEffortGitBranch,
  isPersistableMsg,
  cloneMsgForPersistence,
  cloneHistoryForPersistence,
  truncateMsgInPlace,
  truncateHistoryInPlace,
  isPlainObject,
  truncateTextValue,
  compactInputObjectForEvent,
  sanitizeAppToolEventData,
  buildEssentialAppToolEventData,
  buildAppToolEventTrimCandidates,
  encodeRecord,
}

export type { SessionWriterOptions }
