import fs from 'node:fs'
import fsp from 'node:fs/promises'
import readline from 'node:readline'
import path from 'node:path'
import type { ChatHistory } from '../../../chat/engine'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { HistoryStateRecord, SessionMetaRecord, SessionRecord, UiMsgRecord } from './records'
import { getSessionsRoot } from './paths'

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

function reviveMsg(raw: Msg): Msg {
  return { ...raw, timestamp: new Date((raw as any).timestamp) }
}

function reviveHistory(history: ChatHistory): ChatHistory {
  return history
}

export async function readSessionFile(filePath: string): Promise<SessionReplay> {
  let meta: SessionMetaRecord | null = null
  let lastHistory: HistoryStateRecord | null = null
  const msgById = new Map<string, Msg>()
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
  }

  if (!meta) {
    throw new Error(`Invalid session file (missing session_meta): ${filePath}`)
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
}): Promise<string | null> {
  const sessionsRoot = getSessionsRoot(args)
  const cwdReal = await fsp.realpath(args.cwd).catch(() => null)

  const candidates: string[] = []

  const years = await fsp.readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])
  for (const y of years) {
    if (!y.isDirectory()) continue
    const yearDir = path.join(sessionsRoot, y.name)
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
  let lastUserPrompt: string | null = null
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
      continue
    }
    if (name === 'ui_stats') {
      if (messageCount === null) messageCount = coerceNumber((data as any).uiMsgCount)
      if (!lastUserPrompt) lastUserPrompt = coerceString((data as any).lastUserPrompt)
      if (messageCount !== null && lastUserPrompt) break
    }
  }

  return { messageCount, lastUserPrompt, label }
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
}): Promise<SessionSummary[]> {
  const sessionsRoot = getSessionsRoot(args)
  const cwdReal = await fsp.realpath(args.cwd).catch(() => null)
  const includeAllProjects = Boolean(args.includeAllProjects)
  const limit = args.limit ?? 200

  const candidates: string[] = []

  const years = await fsp.readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])
  for (const y of years) {
    if (!y.isDirectory()) continue
    const yearDir = path.join(sessionsRoot, y.name)
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
