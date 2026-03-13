import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptMessage } from '../prompts/index.js'
import { getSessionMessages, listSessions } from './sessions.js'

const { state } = vi.hoisted(() => ({
  state: {
    listRecentSessions: vi.fn(),
    readSessionFile: vi.fn(),
    stat: vi.fn(),
    open: vi.fn(),
  },
}))

vi.mock('node:fs/promises', () => ({
  default: {
    stat: (args: unknown) => state.stat(args),
    open: (...args: unknown[]) => state.open(...args),
  },
}))

vi.mock('../features/repl/sessionSave/reader.js', () => ({
  listRecentSessions: (args: unknown) => state.listRecentSessions(args),
  readSessionFile: (args: unknown) => state.readSessionFile(args),
}))

function createHistory(prompt: string, response: string): PromptMessage[] {
  return [
    {
      role: 'user',
      content: [{ type: 'text', text: prompt }],
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: response }],
    },
  ]
}

function createFileHandleWithTail(tailText: string) {
  const payload = Buffer.from(tailText, 'utf8')
  return {
    stat: vi.fn(async () => ({ size: payload.length })),
    read: vi.fn(
      async (buffer: Buffer, offset: number, length: number, position: number) => {
        const start = Math.max(0, position)
        const end = Math.min(payload.length, start + length)
        const bytesRead = end > start ? payload.copy(buffer, offset, start, end) : 0
        return { bytesRead, buffer }
      },
    ),
    close: vi.fn(async () => undefined),
  }
}

describe('sdk sessions facade', () => {
  beforeEach(() => {
    state.listRecentSessions.mockReset()
    state.readSessionFile.mockReset()
    state.stat.mockReset()
    state.open.mockReset()
  })

  it('lists sessions and maps summaries to SDKSessionInfo', async () => {
    state.listRecentSessions.mockResolvedValue([
      {
        filePath: '/sessions/s2.jsonl',
        meta: {
          type: 'session_meta',
          v: 1,
          ts: '2026-03-01T00:00:00.000Z',
          sessionId: 's2',
          startedAt: '2026-03-01T00:00:00.000Z',
          cwd: '/repo-b',
          provider: 'anthropic',
          gitBranch: 'feature/sdk',
        },
        updatedAt: new Date('2026-03-01T00:10:00.000Z'),
        messageCount: 4,
        lastUserPrompt: 'create tests',
        label: 'SDK work',
      },
      {
        filePath: '/sessions/s1.jsonl',
        meta: {
          type: 'session_meta',
          v: 1,
          ts: '2026-02-28T00:00:00.000Z',
          sessionId: 's1',
          startedAt: '2026-02-28T00:00:00.000Z',
          cwd: '/repo-a',
          provider: 'anthropic',
        },
        updatedAt: new Date('2026-02-28T00:05:00.000Z'),
        messageCount: 2,
        lastUserPrompt: 'hello',
        label: null,
      },
    ])
    state.stat.mockResolvedValueOnce({ size: 512 })
    state.stat.mockResolvedValueOnce({ size: 128 })
    state.open.mockResolvedValueOnce(
      createFileHandleWithTail(
        `${JSON.stringify({
          type: 'event',
          name: 'ui_stats',
          data: { firstUserPrompt: 'first prompt s2' },
        })}\n`,
      ),
    )
    state.open.mockResolvedValueOnce(
      createFileHandleWithTail(
        `${JSON.stringify({
          type: 'event',
          name: 'ui_stats',
          data: { firstUserPrompt: 'first prompt s1' },
        })}\n`,
      ),
    )

    const out = await listSessions({ dir: '/repo', limit: 5 })

    expect(state.listRecentSessions).toHaveBeenCalledWith({
      cwd: '/repo',
      limit: 5,
    })
    expect(out).toEqual([
      {
        sessionId: 's2',
        summary: 'SDK work',
        lastModified: new Date('2026-03-01T00:10:00.000Z').getTime(),
        fileSize: 512,
        customTitle: 'SDK work',
        firstPrompt: 'first prompt s2',
        gitBranch: 'feature/sdk',
        cwd: '/repo-b',
      },
      {
        sessionId: 's1',
        summary: 'hello',
        lastModified: new Date('2026-02-28T00:05:00.000Z').getTime(),
        fileSize: 128,
        firstPrompt: 'first prompt s1',
        cwd: '/repo-a',
      },
    ])
  })

  it('validates listSessions external output', async () => {
    state.listRecentSessions.mockResolvedValue([
      {
        filePath: '/sessions/bad.jsonl',
        meta: {
          type: 'session_meta',
          v: 1,
          ts: '2026-03-01T00:00:00.000Z',
          // sessionId missing on purpose
          startedAt: '2026-03-01T00:00:00.000Z',
          cwd: '/repo',
          provider: 'anthropic',
        },
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        messageCount: 1,
        lastUserPrompt: 'bad',
        label: null,
      } as any,
    ])

    await expect(listSessions()).rejects.toThrow('Invalid listSessions output')
  })

  it('falls back to base summary when firstPrompt enrichment fails', async () => {
    state.listRecentSessions.mockResolvedValue([
      {
        filePath: '/sessions/s1.jsonl',
        meta: {
          type: 'session_meta',
          v: 1,
          ts: '2026-03-01T00:00:00.000Z',
          sessionId: 's1',
          startedAt: '2026-03-01T00:00:00.000Z',
          cwd: '/repo',
          provider: 'anthropic',
        },
        updatedAt: new Date('2026-03-01T00:10:00.000Z'),
        messageCount: 2,
        lastUserPrompt: 'hello',
        label: null,
      },
    ])
    state.stat.mockResolvedValue({ size: 11 })
    state.open.mockRejectedValue(new Error('corrupt'))

    await expect(listSessions()).resolves.toEqual([
      {
        sessionId: 's1',
        summary: 'hello',
        lastModified: new Date('2026-03-01T00:10:00.000Z').getTime(),
        fileSize: 0,
        cwd: '/repo',
      },
    ])
  })

  it('continues listing when one session file is unreadable', async () => {
    state.listRecentSessions.mockResolvedValue([
      {
        filePath: '/sessions/s-bad.jsonl',
        meta: {
          type: 'session_meta',
          v: 1,
          ts: '2026-03-01T00:00:00.000Z',
          sessionId: 's-bad',
          startedAt: '2026-03-01T00:00:00.000Z',
          cwd: '/repo',
          provider: 'anthropic',
        },
        updatedAt: new Date('2026-03-01T00:10:00.000Z'),
        messageCount: 2,
        lastUserPrompt: 'bad',
        label: null,
      },
      {
        filePath: '/sessions/s-good.jsonl',
        meta: {
          type: 'session_meta',
          v: 1,
          ts: '2026-03-02T00:00:00.000Z',
          sessionId: 's-good',
          startedAt: '2026-03-02T00:00:00.000Z',
          cwd: '/repo',
          provider: 'anthropic',
        },
        updatedAt: new Date('2026-03-02T00:10:00.000Z'),
        messageCount: 2,
        lastUserPrompt: 'good',
        label: null,
      },
    ])
    state.stat.mockRejectedValueOnce(new Error('ENOENT'))
    state.stat.mockResolvedValueOnce({ size: 42 })
    state.open.mockResolvedValueOnce(
      createFileHandleWithTail(
        `${JSON.stringify({
          type: 'event',
          name: 'ui_stats',
          data: { firstUserPrompt: 'first good' },
        })}\n`,
      ),
    )

    await expect(listSessions()).resolves.toEqual([
      {
        sessionId: 's-bad',
        summary: 'bad',
        lastModified: new Date('2026-03-01T00:10:00.000Z').getTime(),
        fileSize: 0,
        cwd: '/repo',
      },
      {
        sessionId: 's-good',
        summary: 'good',
        lastModified: new Date('2026-03-02T00:10:00.000Z').getTime(),
        fileSize: 42,
        firstPrompt: 'first good',
        cwd: '/repo',
      },
    ])
  })

  it('returns session messages with offset/limit slicing', async () => {
    const history = createHistory('hello', 'world')
    state.listRecentSessions.mockResolvedValue([
      {
        filePath: '/sessions/s1.jsonl',
        meta: {
          sessionId: 's1',
          cwd: '/repo',
        },
        updatedAt: new Date('2026-03-01T00:10:00.000Z'),
        messageCount: 2,
        lastUserPrompt: 'hello',
        label: null,
      },
    ])
    state.readSessionFile.mockResolvedValue({
      meta: {
        type: 'session_meta',
        v: 1,
        ts: '2026-03-01T00:00:00.000Z',
        sessionId: 's1',
        startedAt: '2026-03-01T00:00:00.000Z',
        cwd: '/repo',
        provider: 'anthropic',
      },
      messages: [],
      history,
      parseErrors: 0,
    })

    const out = await getSessionMessages('s1', { dir: '/repo', offset: 1, limit: 1 })

    expect(state.listRecentSessions).toHaveBeenCalledWith({
      cwd: '/repo',
      limit: 800,
    })
    expect(state.readSessionFile).toHaveBeenCalledWith('/sessions/s1.jsonl')
    expect(out).toEqual([
      {
        type: 'assistant',
        uuid: 's1:2',
        session_id: 's1',
        message: history[1],
        parent_tool_use_id: null,
      },
    ])
  })

  it('throws when requested session cannot be found', async () => {
    state.listRecentSessions.mockResolvedValue([])

    await expect(getSessionMessages('missing-session')).rejects.toThrow('Session missing-session not found')
  })

  it('validates getSessionMessages external replay payload', async () => {
    state.listRecentSessions.mockResolvedValue([
      {
        filePath: '/sessions/s1.jsonl',
        meta: {
          sessionId: 's1',
          cwd: '/repo',
        },
        updatedAt: new Date('2026-03-01T00:10:00.000Z'),
        messageCount: 2,
        lastUserPrompt: 'hello',
        label: null,
      },
    ])
    state.readSessionFile.mockResolvedValue({
      meta: {
        type: 'session_meta',
        v: 1,
        ts: '2026-03-01T00:00:00.000Z',
        sessionId: 123,
        startedAt: '2026-03-01T00:00:00.000Z',
        cwd: '/repo',
        provider: 'anthropic',
      },
      messages: [],
      history: [],
      parseErrors: 0,
    })

    await expect(getSessionMessages('s1')).rejects.toThrow('Invalid getSessionMessages output')
  })
})
