import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptMessage } from '../prompts/index.js'
import { getSessionMessages, listSessions } from './sessions.js'

const { state } = vi.hoisted(() => ({
  state: {
    listRecentSessions: vi.fn(),
    readSessionFile: vi.fn(),
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

describe('sdk sessions facade', () => {
  beforeEach(() => {
    state.listRecentSessions.mockReset()
    state.readSessionFile.mockReset()
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
        fileSize: 0,
        customTitle: 'SDK work',
        gitBranch: 'feature/sdk',
        cwd: '/repo-b',
      },
      {
        sessionId: 's1',
        summary: 'hello',
        lastModified: new Date('2026-02-28T00:05:00.000Z').getTime(),
        fileSize: 0,
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
