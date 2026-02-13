import { describe, expect, it } from 'vitest'
import { asThreadMessages, asThreadReplay } from './rpcParsers'

describe('rpcParsers', () => {
  it('parses thread message rows and filters invalid entries', () => {
    const parsed = asThreadMessages({
      data: [
        { id: 'm1', kind: 'message', role: 'assistant', text: 'hello' },
        { id: 't1', kind: 'tool', toolName: 'Bash', status: 'running', summary: 'Running', detailLines: ['ok', 1] },
        { id: 'bad', kind: 'message', role: 'system', text: 'ignore' },
      ],
      nextCursor: 'cursor-1',
    })

    expect(parsed.nextCursor).toBe('cursor-1')
    expect(parsed.data).toHaveLength(2)
    expect(parsed.data[0]).toMatchObject({ kind: 'message', text: 'hello' })
    expect(parsed.data[1]).toMatchObject({ kind: 'tool', toolName: 'Bash', status: 'running' })
  })

  it('normalizes replay state and keeps only valid pending inputs', () => {
    const parsed = asThreadReplay({
      data: [{ replaySeq: 10, method: 'turn/event', params: { ok: true } }, { replaySeq: 'bad', method: 'x' }],
      nextCursor: 11,
      latestCursor: 12,
      hasGap: true,
      state: {
        mode: 'unknown-mode',
        pendingInputCount: 3,
        pendingInputs: [
          {
            inputId: 'i-1',
            threadId: 'th-1',
            turnId: 'turn-1',
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'pending',
            createdAt: '2026-02-10T00:00:00.000Z',
            expiresAt: '2026-02-10T00:05:00.000Z',
            payload: { toolName: 'Bash' },
          },
          {
            inputId: 'i-2',
            threadId: 'th-1',
            turnId: 'turn-1',
            toolUseId: 'tool-2',
            kind: 'approval',
            status: 'submitted',
            createdAt: '2026-02-10T00:00:00.000Z',
            expiresAt: '2026-02-10T00:05:00.000Z',
          },
        ],
        updatedAt: '2026-02-10T00:06:00.000Z',
      },
    })

    expect(parsed.data).toHaveLength(1)
    expect(parsed.nextCursor).toBe(11)
    expect(parsed.latestCursor).toBe(12)
    expect(parsed.hasGap).toBe(true)
    expect(parsed.state?.mode).toBe('normal')
    expect(parsed.state?.pendingInputCount).toBe(3)
    expect(parsed.state?.pendingInputs).toHaveLength(1)
    expect(parsed.state?.pendingInputs[0]?.inputId).toBe('i-1')
  })
})
