import { describe, expect, it } from 'vitest'
import {
  parseInputSubmitResponse,
  parseResolvedInputsResponse,
  parseThreadListResponse,
  parseThreadMessagesResponse,
  parseThreadReplayResponse,
  parseThreadStartResponse,
  parseTurnStartLikeResponse,
} from './rpcContracts'

describe('rpcContracts', () => {
  it('parses thread/start response and rejects invalid payload', () => {
    expect(parseThreadStartResponse({ thread: { id: 'thread-1', cwd: '/repo' } })).toEqual({
      id: 'thread-1',
      cwd: '/repo',
    })
    expect(parseThreadStartResponse({ thread: { id: '' } })).toBeNull()
    expect(parseThreadStartResponse({})).toBeNull()
  })

  it('parses turn/start and command/dispatch like response shape', () => {
    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
          },
        },
      }),
    ).toEqual({
      turnId: 'turn-1',
      localStdout: 'hello',
      localDiagnostics: {
        kind: 'formax.context_diagnostics',
        schemaVersion: 1,
        mode: 'normal',
      },
    })
    expect(parseTurnStartLikeResponse({ turn: {}, local: {} })).toEqual({
      turnId: null,
      localStdout: '',
      localDiagnostics: null,
    })
  })

  it('parses turn/input/submit response status with unknown fallback', () => {
    expect(parseInputSubmitResponse({ status: 'submitted' })).toEqual({ status: 'submitted' })
    expect(parseInputSubmitResponse({ status: '' })).toEqual({ status: 'unknown' })
    expect(parseInputSubmitResponse({})).toEqual({ status: 'unknown' })
  })

  it('parses thread/replay response via canonical replay parser', () => {
    const replay = parseThreadReplayResponse({
      data: [{ replaySeq: 7, method: 'turn/event', params: { ok: true } }],
      nextCursor: 8,
      latestCursor: 9,
      hasGap: false,
    })

    expect(replay.data).toHaveLength(1)
    expect(replay.nextCursor).toBe(8)
    expect(replay.latestCursor).toBe(9)
    expect(replay.hasGap).toBe(false)
  })

  it('parses thread/list and thread/messages payloads via shared parser contracts', () => {
    const threads = parseThreadListResponse({
      data: [{ id: 'thread-1', cwd: '/repo', createdAt: 'a', updatedAt: 'b', messageCount: 1, lastUserPrompt: null, label: null }],
    })
    expect(threads).toHaveLength(1)
    expect(threads[0]?.id).toBe('thread-1')

    const messages = parseThreadMessagesResponse({
      data: [{ id: 'm1', kind: 'message', role: 'assistant', text: 'hello' }],
      nextCursor: 'cursor-1',
    })
    expect(messages.data).toHaveLength(1)
    expect(messages.nextCursor).toBe('cursor-1')
  })

  it('parses stale resolved inputs via shared parser contract', () => {
    const resolved = parseResolvedInputsResponse({
      staleInputs: [
        {
          inputId: 'input-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          kind: 'approval',
          status: 'submitted',
          createdAt: '2026-02-20T00:00:00.000Z',
          expiresAt: '2026-02-20T00:01:00.000Z',
          resolvedAt: '2026-02-20T00:00:30.000Z',
        },
      ],
    })

    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.inputId).toBe('input-1')
  })
})
