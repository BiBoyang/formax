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

  for (const filePath of candidates.slice(0, 200)) {
    try {
      const replay = await readSessionFile(filePath)
      if (cwdReal && replay.meta.cwdReal) {
        if (replay.meta.cwdReal === cwdReal) return filePath
        continue
      }
      if (replay.meta.cwd === args.cwd) return filePath
    } catch {
      continue
    }
  }

  return null
}

