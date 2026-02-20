import { describe, expect, it } from 'vitest'
import {
  parseInputSubmitResponse,
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
    expect(parseTurnStartLikeResponse({ turn: { id: 'turn-1' }, local: { stdout: 'hello' } })).toEqual({
      turnId: 'turn-1',
      localStdout: 'hello',
    })
    expect(parseTurnStartLikeResponse({ turn: {}, local: {} })).toEqual({
      turnId: null,
      localStdout: '',
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
})
