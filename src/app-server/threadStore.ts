import fs from 'node:fs/promises'
import path from 'node:path'
import {
  findSessionFileBySessionId,
  listRecentSessions,
  readSessionFile,
  readSessionPreview,
  readSessionSummary,
  SessionWriter,
  type SessionSummary,
} from '../features/repl/sessionSave/index.js'
import type { InputResolvedPayload } from './protocol/input.js'
import type { Thread, ThreadListParams, ThreadMessagesParams, ThreadStartParams, ThreadSummary } from './protocol.js'
import { readPersistedToolMessagesFromSession, readStaleInputsFromSession } from './store/sessionEventReader.js'

export type ThreadStoreOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}

export type ThreadListResult = {
  data: ThreadSummary[]
  nextCursor: string | null
}

export type ThreadReadResult = {
  thread: Thread
  transcriptPreview: Array<{ role: 'user' | 'assistant'; text: string }>
}

export type ThreadMessage = {
  id: string
  kind: 'message'
  role: 'user' | 'assistant'
  text: string
}

export type ThreadToolMessage = {
  id: string
  kind: 'tool'
  toolUseId?: string
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  paramsText?: string
  detailLines?: string[]
}

export type ThreadMessagesResult = {
  data: Array<ThreadMessage | ThreadToolMessage>
  nextCursor: string | null
}

type ThreadTimelineEntry = {
  occurredAtMs: number
  sequence: number
  item: ThreadMessage | ThreadToolMessage
}

export type ThreadResumeResult = {
  thread: Thread
  staleInputs: InputResolvedPayload[]
}

function toThreadSummary(summary: SessionSummary): ThreadSummary {
  return {
    id: summary.meta.sessionId,
    cwd: summary.meta.cwd,
    createdAt: summary.meta.startedAt,
    updatedAt: summary.updatedAt.toISOString(),
    messageCount: summary.messageCount,
    lastUserPrompt: summary.lastUserPrompt,
    label: summary.label,
  }
}

function toThread(summary: SessionSummary): Thread {
  return {
    id: summary.meta.sessionId,
    cwd: summary.meta.cwd,
    createdAt: summary.meta.startedAt,
    updatedAt: summary.updatedAt.toISOString(),
  }
}

function parseCursorOffset(cursor?: string): number {
  if (!cursor) return 0
  if (!/^\d+$/.test(cursor)) throw new Error('Invalid params.cursor: expected numeric offset')
  const value = Number(cursor)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid params.cursor: expected non-negative integer offset')
  }
  return value
}

function flattenMessageText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const chunks: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if ((part as { type?: unknown }).type !== 'text') continue
    const text = (part as { text?: unknown }).text
    if (typeof text !== 'string') continue
    const trimmed = text.trim()
    if (!trimmed) continue
    chunks.push(trimmed)
  }
  return chunks.join('\n\n')
}

function parseOccurredAtMs(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function extractThreadMessages(history: Array<{ role: 'user' | 'assistant'; content: unknown }>): ThreadMessage[] {
  const out: ThreadMessage[] = []
  for (let idx = 0; idx < history.length; idx += 1) {
    const message = history[idx]
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue
    const text = flattenMessageText(message.content)
    if (!text) continue
    out.push({
      id: String(out.length),
      kind: 'message',
      role: message.role,
      text,
    })
  }
  return out
}

function formatToolParamsText(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return undefined
  const parts = entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  const joined = parts.join(', ')
  return joined.length > 180 ? `${joined.slice(0, 180)}...` : joined
}

function collectToolDetailLines(message: {
  content?: unknown
  toolInfo?: {
    result?: unknown
    middleLines?: unknown
  }
}): string[] {
  const lines: string[] = []
  if (typeof message.content === 'string') {
    const summaryLine = message.content.trim()
    if (summaryLine) lines.push(summaryLine)
  }

  if (Array.isArray(message.toolInfo?.middleLines)) {
    for (const line of message.toolInfo.middleLines) {
      if (typeof line !== 'string') continue
      const trimmed = line.trim()
      if (!trimmed) continue
      lines.push(trimmed)
    }
  }

  if (typeof message.toolInfo?.result === 'string') {
    for (const line of message.toolInfo.result.split('\n')) {
      const trimmed = line.trimEnd()
      if (!trimmed.trim()) continue
      lines.push(trimmed)
      if (lines.length >= 120) break
    }
  }

  const deduped: string[] = []
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line) continue
    deduped.push(line)
  }
  return deduped
}

function extractThreadTimelineFromUi(
  messages: Array<{
    id?: unknown
    role?: unknown
    content?: unknown
    timestamp?: unknown
    toolInfo?: {
      toolUseId?: unknown
      name?: unknown
      input?: unknown
      status?: unknown
      result?: unknown
      middleLines?: unknown
    }
  }>,
): ThreadTimelineEntry[] {
  const out: ThreadTimelineEntry[] = []
  let sequence = 0
  for (const message of messages) {
    if (!message) continue
    const id = typeof message.id === 'string' && message.id.trim() ? message.id : String(out.length)
    const occurredAtMs = parseOccurredAtMs(message.timestamp)
    if (message.role === 'user' || message.role === 'assistant') {
      if (typeof message.content !== 'string') continue
      const text = message.content.trim()
      if (!text) continue
      out.push({
        occurredAtMs,
        sequence: sequence++,
        item: {
          id,
          kind: 'message',
          role: message.role,
          text,
        },
      })
      continue
    }

    if (message.role !== 'tool' || !message.toolInfo || typeof message.toolInfo.name !== 'string') continue
    const status =
      message.toolInfo.status === 'error'
        ? 'error'
        : message.toolInfo.status === 'running'
          ? 'running'
          : 'completed'
    const detailLines = collectToolDetailLines(message)
    const paramsText = formatToolParamsText(message.toolInfo.input)
    const summary =
      detailLines[0] ??
      (status === 'error'
        ? 'Tool failed'
        : status === 'running'
          ? 'Tool running'
          : 'Tool completed')
    out.push({
      occurredAtMs,
      sequence: sequence++,
      item: {
        id,
        kind: 'tool',
        toolUseId:
          typeof message.toolInfo.toolUseId === 'string' && message.toolInfo.toolUseId.trim()
            ? message.toolInfo.toolUseId
            : undefined,
        toolName: message.toolInfo.name,
        status,
        summary,
        ...(paramsText ? { paramsText } : {}),
        ...(detailLines.length > 0 ? { detailLines } : {}),
      },
    })
  }
  return out
}

export class ThreadStore {
  private readonly cwd: string
  private readonly env?: NodeJS.ProcessEnv
  private readonly platform?: string
  private readonly homedir?: string

  constructor(args: ThreadStoreOptions = {}) {
    this.cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    this.env = args.env
    this.platform = args.platform
    this.homedir = args.homedir
  }

  async startThread(params: ThreadStartParams): Promise<Thread> {
    const cwd = params.cwd ? path.resolve(params.cwd) : this.cwd
    const { writer, meta, filePath } = await SessionWriter.createNew({
      cwd,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    await writer.shutdown()

    const stat = await fs.stat(filePath).catch(() => null)
    return {
      id: meta.sessionId,
      cwd: meta.cwd,
      createdAt: meta.startedAt,
      updatedAt: stat?.mtime.toISOString() ?? meta.startedAt,
    }
  }

  async resumeThread(threadId: string): Promise<ThreadResumeResult> {
    const filePath = await findSessionFileBySessionId({
      cwd: this.cwd,
      sessionId: threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    if (!filePath) throw new Error(`Thread not found: ${threadId}`)

    const [summary, staleInputs] = await Promise.all([
      readSessionSummary(filePath),
      readStaleInputsFromSession({ filePath }),
    ])
    return {
      thread: toThread(summary),
      staleInputs,
    }
  }

  async listThreads(params: ThreadListParams): Promise<ThreadListResult> {
    const offset = parseCursorOffset(params.cursor)
    const limit = params.limit
    const needed = Math.min(800, offset + limit + 1)

    const all = await listRecentSessions({
      cwd: this.cwd,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
      includeAllProjects: true,
      limit: needed,
    })

    const page = all.slice(offset, offset + limit).map(toThreadSummary)
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null
    return { data: page, nextCursor }
  }

  async readThread(threadId: string): Promise<ThreadReadResult> {
    const filePath = await findSessionFileBySessionId({
      cwd: this.cwd,
      sessionId: threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    if (!filePath) throw new Error(`Thread not found: ${threadId}`)

    const [summary, transcriptPreview] = await Promise.all([
      readSessionSummary(filePath),
      readSessionPreview(filePath),
    ])

    return {
      thread: toThread(summary),
      transcriptPreview,
    }
  }

  async listThreadMessages(params: ThreadMessagesParams): Promise<ThreadMessagesResult> {
    const filePath = await findSessionFileBySessionId({
      cwd: this.cwd,
      sessionId: params.threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    if (!filePath) throw new Error(`Thread not found: ${params.threadId}`)

    const replay = await readSessionFile(filePath)
    const fromUi = extractThreadTimelineFromUi(
      replay.messages as Array<{ id?: unknown; role?: unknown; content?: unknown; timestamp?: unknown }>,
    )
    const persistedTools = await readPersistedToolMessagesFromSession({ filePath })
    const all = (() => {
      if (fromUi.length === 0) {
        return extractThreadMessages(replay.history as Array<{ role: 'user' | 'assistant'; content: unknown }>)
      }

      const timeline = [...fromUi]
      const knownToolUseIds = new Set<string>()
      for (const entry of timeline) {
        if (entry.item.kind !== 'tool') continue
        if (!entry.item.toolUseId) continue
        knownToolUseIds.add(entry.item.toolUseId)
      }

      let extraSequence = timeline.length
      for (const tool of persistedTools) {
        if (tool.toolUseId && knownToolUseIds.has(tool.toolUseId)) continue
        timeline.push({
          occurredAtMs: tool.occurredAtMs,
          sequence: extraSequence++,
          item: {
            id: tool.id,
            kind: 'tool',
            ...(tool.toolUseId ? { toolUseId: tool.toolUseId } : {}),
            toolName: tool.toolName,
            status: tool.status,
            summary: tool.summary,
            ...(tool.paramsText ? { paramsText: tool.paramsText } : {}),
            ...(tool.detailLines.length > 0 ? { detailLines: tool.detailLines } : {}),
          },
        })
      }

      timeline.sort((a, b) => {
        const aTime = a.occurredAtMs > 0 ? a.occurredAtMs : Number.MAX_SAFE_INTEGER
        const bTime = b.occurredAtMs > 0 ? b.occurredAtMs : Number.MAX_SAFE_INTEGER
        if (aTime !== bTime) return aTime - bTime
        return a.sequence - b.sequence
      })
      return timeline.map((entry) => entry.item)
    })()
    const end = params.cursor == null ? all.length : Math.min(parseCursorOffset(params.cursor), all.length)
    const start = Math.max(0, end - params.limit)
    const page = all.slice(start, end)
    const nextCursor = start > 0 ? String(start) : null

    return {
      data: page,
      nextCursor,
    }
  }
}
