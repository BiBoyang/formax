import fs from 'node:fs/promises'
import path from 'node:path'
import {
  findSessionFileBySessionId,
  listRecentSessions,
  readSessionPreview,
  readSessionSummary,
  SessionWriter,
  type SessionSummary,
} from '../features/repl/sessionSave/index.js'
import type { InputResolvedPayload } from './protocol/input.js'
import type { Thread, ThreadListParams, ThreadStartParams, ThreadSummary } from './protocol.js'
import { readStaleInputsFromSession } from './store/sessionEventReader.js'

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
}
