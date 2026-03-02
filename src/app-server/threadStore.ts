import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  readSessionFile,
  readSessionPreview,
  readSessionSummary,
  SessionWriter,
  type SessionSummary,
} from '../features/repl/sessionSave/index.js'
import { computeEditPatchStartLineNumber } from '../features/repl/controller/streaming/patchStartLineNumber.js'
import type { InputResolvedPayload } from './protocol/input.js'
import type {
  Thread,
  ThreadListParams,
  ThreadMessagesParams,
  ThreadRenameParams,
  ThreadStartParams,
  ThreadSummary,
} from './protocol.js'
import { readPersistedToolMessagesFromSession, readStaleInputsFromSession } from './store/sessionEventReader.js'
import { FileThreadArchiveStore, type ThreadArchiveStore } from './store/threadArchiveStore.js'
import {
  FileThreadGroupVisibilityStore,
  type ThreadGroupVisibilityStore,
} from './store/threadGroupVisibilityStore.js'

export type ThreadStoreOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
  archiveStore?: ThreadArchiveStore
  groupVisibilityStore?: ThreadGroupVisibilityStore
}

export type ThreadListResult = {
  data: ThreadSummary[]
  nextCursor: string | null
  hiddenGroupCwds?: string[]
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
  input?: Record<string, unknown>
  patchStartLineNumber?: number
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

export type ThreadRenameResult = {
  thread: ThreadSummary
}

export type ThreadArchiveResult = {
  thread: ThreadSummary
}

export type ThreadGroupHideResult = {
  hiddenGroupCwds: string[]
}

type ProvisionalThread = {
  id: string
  cwd: string
  createdAt: string
  updatedAt: string
  label: string | null
}

function toThreadSummary(
  summary: SessionSummary,
  archived: boolean,
  options?: { archivedAt?: string | null },
): ThreadSummary {
  const archivedAt = archived ? options?.archivedAt ?? null : null
  return {
    id: summary.meta.sessionId,
    cwd: summary.meta.cwd,
    createdAt: summary.meta.startedAt,
    updatedAt: summary.updatedAt.toISOString(),
    messageCount: summary.messageCount,
    lastUserPrompt: summary.lastUserPrompt,
    label: summary.label,
    archivedAt,
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

function toThreadSummaryFromProvisional(
  thread: ProvisionalThread,
  archived: boolean,
  options?: { archivedAt?: string | null },
): ThreadSummary {
  const archivedAt = archived ? options?.archivedAt ?? null : null
  return {
    id: thread.id,
    cwd: thread.cwd,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: 0,
    lastUserPrompt: null,
    label: thread.label,
    archivedAt,
  }
}

function toThreadFromProvisional(thread: ProvisionalThread): Thread {
  return {
    id: thread.id,
    cwd: thread.cwd,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
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

function mergeToolDetailLines(existing: string[] | undefined, incoming: string[]): string[] | undefined {
  const merged = [...(existing ?? [])]
  for (const line of incoming) {
    if (!line.trim()) continue
    if (merged.includes(line)) continue
    merged.push(line)
  }
  return merged.length > 0 ? merged : undefined
}

function parseToolUseInput(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value as Record<string, unknown>).length > 0
}

function choosePreferredInput(...candidates: Array<Record<string, unknown> | undefined>): Record<string, unknown> | undefined {
  for (const candidate of candidates) {
    if (!isNonEmptyRecord(candidate)) continue
    return candidate
  }
  return undefined
}

function parseToolUseId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function parseToolUseName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function extractToolUseInputById(
  history: Array<{
    role?: unknown
    content?: unknown
  }>,
): Map<string, { toolName?: string; input?: Record<string, unknown> }> {
  const byId = new Map<string, { toolName?: string; input?: Record<string, unknown> }>()
  for (const message of history) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      if (record.type !== 'tool_use') continue
      const id = parseToolUseId(record.id)
      if (!id) continue
      const input = parseToolUseInput(record.input)
      const toolName = parseToolUseName(record.name)
      const current = byId.get(id)
      byId.set(id, {
        ...(current ?? {}),
        ...(toolName ? { toolName } : {}),
        ...(input ? { input } : {}),
      })
    }
  }
  return byId
}

function resolveEditPatchStartLineNumber(args: {
  cwd: string
  toolName: string
  input?: Record<string, unknown>
}): number | undefined {
  if (args.toolName !== 'Edit') return undefined
  if (!args.input) return undefined
  const lineNumber = computeEditPatchStartLineNumber({
    cwd: args.cwd,
    input: args.input,
  })
  return typeof lineNumber === 'number' && Number.isFinite(lineNumber) && lineNumber > 0
    ? Math.floor(lineNumber)
    : undefined
}

function extractThreadTimelineFromUi(
  messages: Array<{
    id?: unknown
    role?: unknown
    content?: unknown
    timestamp?: unknown
    ui?: { kind?: unknown }
    toolInfo?: {
      toolUseId?: unknown
      name?: unknown
      input?: unknown
      patchStartLineNumber?: unknown
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
      if (message.role === 'assistant' && message.ui?.kind === 'thinking_block') continue
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
    const input = isNonEmptyRecord(message.toolInfo.input)
      ? (message.toolInfo.input as Record<string, unknown>)
      : undefined
    const detailLines = collectToolDetailLines(message)
    const paramsText = formatToolParamsText(input)
    const patchStartLineNumber =
      typeof message.toolInfo.patchStartLineNumber === 'number' &&
      Number.isFinite(message.toolInfo.patchStartLineNumber) &&
      message.toolInfo.patchStartLineNumber > 0
        ? Math.floor(message.toolInfo.patchStartLineNumber)
        : undefined
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
        ...(input ? { input } : {}),
        ...(patchStartLineNumber !== undefined ? { patchStartLineNumber } : {}),
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
  private readonly archiveStore: ThreadArchiveStore
  private readonly groupVisibilityStore: ThreadGroupVisibilityStore
  private readonly provisionalThreads = new Map<string, ProvisionalThread>()

  constructor(args: ThreadStoreOptions = {}) {
    this.cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    this.env = args.env
    this.platform = args.platform
    this.homedir = args.homedir
    this.archiveStore = args.archiveStore ?? new FileThreadArchiveStore()
    this.groupVisibilityStore = args.groupVisibilityStore ?? new FileThreadGroupVisibilityStore()
  }

  async startThread(params: ThreadStartParams): Promise<Thread> {
    const cwd = params.cwd ? path.resolve(params.cwd) : this.cwd
    const now = new Date().toISOString()
    const thread: ProvisionalThread = {
      id: randomUUID(),
      cwd,
      createdAt: now,
      updatedAt: now,
      label: null,
    }
    this.provisionalThreads.set(thread.id, thread)
    return toThreadFromProvisional(thread)
  }

  async ensureThreadFile(params: { threadId: string; cwd?: string }): Promise<string> {
    const provisional = this.provisionalThreads.get(params.threadId)
    const requestCwd = params.cwd ? path.resolve(params.cwd) : this.cwd
    const candidateCwds = Array.from(new Set([provisional?.cwd, requestCwd, this.cwd].filter((value): value is string => Boolean(value))))

    for (const cwd of candidateCwds) {
      const existing = await this.archiveStore.locateThreadFile({
        cwd,
        sessionId: params.threadId,
        env: this.env,
        platform: this.platform,
        homedir: this.homedir,
      })
      if (!existing) continue
      this.provisionalThreads.delete(params.threadId)
      return existing
    }

    if (provisional) {
      const { writer, filePath } = await SessionWriter.createNew({
        cwd: provisional.cwd,
        env: this.env,
        platform: this.platform,
        homedir: this.homedir,
        sessionId: provisional.id,
        startedAt: provisional.createdAt,
      })
      try {
        if (provisional.label) {
          await writer.appendEvent('session_rename', { label: provisional.label })
        }
      } finally {
        await writer.shutdown()
      }
      this.provisionalThreads.delete(params.threadId)
      return filePath
    }

    throw new Error(`Thread not found: ${params.threadId}`)
  }

  async resumeThread(threadId: string): Promise<ThreadResumeResult> {
    const filePath = await this.archiveStore.locateThreadFile({
      cwd: this.cwd,
      sessionId: threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    if (!filePath) {
      const provisional = this.provisionalThreads.get(threadId)
      if (!provisional) throw new Error(`Thread not found: ${threadId}`)
      return {
        thread: toThreadFromProvisional(provisional),
        staleInputs: [],
      }
    }
    this.provisionalThreads.delete(threadId)

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
    const archived = Boolean(params.archived)
    const offset = parseCursorOffset(params.cursor)
    const limit = params.limit
    const needed = Math.min(800, offset + limit + 1)

    const [all, hiddenGroupCwds] = await Promise.all([
      this.archiveStore.listThreads({
        cwd: this.cwd,
        env: this.env,
        platform: this.platform,
        homedir: this.homedir,
        includeAllProjects: true,
        limit: needed,
        archived,
      }),
      this.groupVisibilityStore.listHiddenGroups({
        cwd: this.cwd,
        env: this.env,
        platform: this.platform,
        homedir: this.homedir,
      }),
    ])
    const persistedRows = all.map((summary) => toThreadSummary(summary, archived))
    const persistedIds = new Set(persistedRows.map((thread) => thread.id))
    for (const id of persistedIds) this.provisionalThreads.delete(id)

    const provisionalRows =
      archived
        ? []
        : Array.from(this.provisionalThreads.values())
            .filter((thread) => !persistedIds.has(thread.id))
            .map((thread) => toThreadSummaryFromProvisional(thread, false))

    const combined = [...persistedRows, ...provisionalRows].sort((a, b) => {
      const aMs = Date.parse(a.updatedAt)
      const bMs = Date.parse(b.updatedAt)
      if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) {
        return bMs - aMs
      }
      return b.id.localeCompare(a.id)
    })

    const page = combined.slice(offset, offset + limit)
    const nextCursor = offset + limit < combined.length ? String(offset + limit) : null
    return { data: page, nextCursor, hiddenGroupCwds }
  }

  async hideThreadGroup(cwd: string): Promise<ThreadGroupHideResult> {
    const hiddenGroupCwds = await this.groupVisibilityStore.markGroupHidden({
      cwd: this.cwd,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
      groupCwd: path.resolve(cwd),
    })
    return { hiddenGroupCwds }
  }

  async readThread(threadId: string): Promise<ThreadReadResult> {
    const filePath = await this.archiveStore.locateThreadFile({
      cwd: this.cwd,
      sessionId: threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    if (!filePath) {
      const provisional = this.provisionalThreads.get(threadId)
      if (!provisional) throw new Error(`Thread not found: ${threadId}`)
      return {
        thread: toThreadFromProvisional(provisional),
        transcriptPreview: [],
      }
    }
    this.provisionalThreads.delete(threadId)

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
    const filePath = await this.archiveStore.locateThreadFile({
      cwd: this.cwd,
      sessionId: params.threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    if (!filePath) {
      if (!this.provisionalThreads.has(params.threadId)) throw new Error(`Thread not found: ${params.threadId}`)
      if (params.cursor !== undefined) parseCursorOffset(params.cursor)
      return {
        data: [],
        nextCursor: null,
      }
    }
    this.provisionalThreads.delete(params.threadId)

    const replay = await readSessionFile(filePath)
    const toolUseInputById = extractToolUseInputById(
      replay.history as Array<{ role?: unknown; content?: unknown }>,
    )
    const fromUi = extractThreadTimelineFromUi(
      replay.messages as Array<{ id?: unknown; role?: unknown; content?: unknown; timestamp?: unknown }>,
    )
    const persistedTools = await readPersistedToolMessagesFromSession({ filePath })
    const all = (() => {
      if (fromUi.length === 0) {
        return extractThreadMessages(replay.history as Array<{ role: 'user' | 'assistant'; content: unknown }>)
      }

      const timeline = [...fromUi]
      for (let index = 0; index < timeline.length; index += 1) {
        const entry = timeline[index]
        if (entry.item.kind !== 'tool') continue
        const historyTool = entry.item.toolUseId ? toolUseInputById.get(entry.item.toolUseId) : undefined
        const input = choosePreferredInput(entry.item.input, historyTool?.input)
        const patchStartLineNumber =
          entry.item.patchStartLineNumber ??
          resolveEditPatchStartLineNumber({
            cwd: replay.meta.cwd,
            toolName: historyTool?.toolName ?? entry.item.toolName,
            input,
          })
        entry.item = {
          ...entry.item,
          ...(input ? { input } : {}),
          ...(patchStartLineNumber !== undefined ? { patchStartLineNumber } : {}),
        }
      }
      const toolIndexByUseId = new Map<string, number>()
      for (let index = 0; index < timeline.length; index += 1) {
        const entry = timeline[index]
        if (entry.item.kind !== 'tool') continue
        if (!entry.item.toolUseId) continue
        if (!toolIndexByUseId.has(entry.item.toolUseId)) {
          toolIndexByUseId.set(entry.item.toolUseId, index)
        }
      }

      let extraSequence = timeline.length
      for (const tool of persistedTools) {
        const existingIndex = tool.toolUseId ? toolIndexByUseId.get(tool.toolUseId) : undefined
        if (existingIndex !== undefined) {
          const existingEntry = timeline[existingIndex]
          const existingTool = existingEntry!.item as ThreadToolMessage
          const mergedDetailLines = mergeToolDetailLines(existingTool.detailLines, tool.detailLines)
          const historyTool = toolUseInputById.get(existingTool.toolUseId!)
          const input = choosePreferredInput(existingTool.input, tool.input, historyTool?.input)
          const patchStartLineNumber =
            existingTool.patchStartLineNumber ??
            tool.patchStartLineNumber ??
            resolveEditPatchStartLineNumber({
              cwd: replay.meta.cwd,
              toolName: historyTool?.toolName ?? existingTool.toolName,
              input,
            })
          existingEntry!.item = {
            ...existingTool,
            ...(input ? { input } : {}),
            ...(patchStartLineNumber !== undefined ? { patchStartLineNumber } : {}),
            ...(existingTool.paramsText ? {} : tool.paramsText ? { paramsText: tool.paramsText } : {}),
            ...(mergedDetailLines ? { detailLines: mergedDetailLines } : {}),
          }
          continue
        }
        const historyTool = tool.toolUseId ? toolUseInputById.get(tool.toolUseId) : undefined
        const input = choosePreferredInput(tool.input, historyTool?.input)
        const patchStartLineNumber =
          tool.patchStartLineNumber ??
          resolveEditPatchStartLineNumber({
            cwd: replay.meta.cwd,
            toolName: historyTool?.toolName ?? tool.toolName,
            input,
          })
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
            ...(input ? { input } : {}),
            ...(patchStartLineNumber !== undefined ? { patchStartLineNumber } : {}),
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

  async renameThread(params: ThreadRenameParams): Promise<ThreadRenameResult> {
    const filePath = await this.archiveStore.locateThreadFile({
      cwd: this.cwd,
      sessionId: params.threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    if (!filePath) {
      const provisional = this.provisionalThreads.get(params.threadId)
      if (!provisional) throw new Error(`Thread not found: ${params.threadId}`)
      provisional.label = params.label
      provisional.updatedAt = new Date().toISOString()
      this.provisionalThreads.set(params.threadId, provisional)
      return { thread: toThreadSummaryFromProvisional(provisional, false) }
    }
    this.provisionalThreads.delete(params.threadId)

    const writer = await SessionWriter.openExisting({ filePath })
    try {
      await writer.appendEvent('session_rename', { label: params.label })
    } finally {
      await writer.shutdown()
    }

    const summary = await readSessionSummary(filePath)
    return { thread: toThreadSummary(summary, false) }
  }

  async archiveThread(threadId: string): Promise<ThreadArchiveResult> {
    const persistedFilePath = await this.archiveStore.locateThreadFile({
      cwd: this.cwd,
      sessionId: threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    if (persistedFilePath) {
      this.provisionalThreads.delete(threadId)
      const archivedAt = new Date().toISOString()
      await this.archiveStore.archiveThread({
        cwd: this.cwd,
        sessionId: threadId,
        env: this.env,
        platform: this.platform,
        homedir: this.homedir,
      })
      const summary = await this.readThreadSummary(threadId, true, { archivedAt })
      return { thread: summary }
    }

    const provisional = this.provisionalThreads.get(threadId)
    if (provisional) {
      const archivedAt = new Date().toISOString()
      await this.ensureThreadFile({ threadId, cwd: provisional.cwd })
      await this.archiveStore.archiveThread({
        cwd: provisional.cwd,
        sessionId: threadId,
        env: this.env,
        platform: this.platform,
        homedir: this.homedir,
      })
      const summary = await this.readThreadSummary(threadId, true, { archivedAt, cwd: provisional.cwd })
      return { thread: summary }
    }

    const archivedAt = new Date().toISOString()
    await this.archiveStore.archiveThread({
      cwd: this.cwd,
      sessionId: threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    const summary = await this.readThreadSummary(threadId, true, { archivedAt })
    return { thread: summary }
  }

  async unarchiveThread(threadId: string): Promise<ThreadArchiveResult> {
    await this.archiveStore.unarchiveThread({
      cwd: this.cwd,
      sessionId: threadId,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    const summary = await this.readThreadSummary(threadId, false)
    return { thread: summary }
  }

  private async readThreadSummary(
    threadId: string,
    archived: boolean,
    options?: { archivedAt?: string | null; cwd?: string },
  ): Promise<ThreadSummary> {
    const lookupCwd = options?.cwd ? path.resolve(options.cwd) : this.cwd
    const filePath = await this.archiveStore.locateThreadFile({
      cwd: lookupCwd,
      sessionId: threadId,
      archived,
      env: this.env,
      platform: this.platform,
      homedir: this.homedir,
    })
    if (!filePath) throw new Error(`Thread not found: ${threadId}`)
    const summary = await readSessionSummary(filePath)
    return toThreadSummary(summary, archived, options)
  }
}

export const __threadStoreTestOnly = {
  toThreadSummaryFromProvisional,
  parseCursorOffset,
  flattenMessageText,
  parseOccurredAtMs,
  extractThreadMessages,
  formatToolParamsText,
  collectToolDetailLines,
  mergeToolDetailLines,
  parseToolUseInput,
  isNonEmptyRecord,
  choosePreferredInput,
  parseToolUseId,
  parseToolUseName,
  extractToolUseInputById,
  resolveEditPatchStartLineNumber,
  extractThreadTimelineFromUi,
}
