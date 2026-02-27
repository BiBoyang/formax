import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openExisting: vi.fn(),
}))

vi.mock('../repl/sessionSave/writer', () => ({
  SessionWriter: {
    openExisting: mocks.openExisting,
  },
}))

import { persistSessionTitle } from './apply'

describe('persistSessionTitle', () => {
  it('uses provided writer without opening file', async () => {
    const writer = {
      appendEvent: vi.fn(async () => {}),
    }

    await persistSessionTitle({ label: 'New title', writer: writer as any })

    expect(writer.appendEvent).toHaveBeenCalledWith('session_rename', {
      label: 'New title',
      source: 'auto_title',
    })
    expect(mocks.openExisting).not.toHaveBeenCalled()
  })

  it('throws when both writer and filePath are missing', async () => {
    await expect(persistSessionTitle({ label: 'x' })).rejects.toThrow(
      'persistSessionTitle requires either writer or filePath',
    )
  })

  it('opens existing session file and flushes/shuts down', async () => {
    const appendEvent = vi.fn(async () => {})
    const flush = vi.fn(async () => {})
    const shutdown = vi.fn(async () => {})
    mocks.openExisting.mockResolvedValueOnce({ appendEvent, flush, shutdown })

    await persistSessionTitle({ label: 'From file', filePath: '/tmp/session.jsonl' })

    expect(mocks.openExisting).toHaveBeenCalledWith({ filePath: '/tmp/session.jsonl' })
    expect(appendEvent).toHaveBeenCalledWith('session_rename', {
      label: 'From file',
      source: 'auto_title',
    })
    expect(flush).toHaveBeenCalledTimes(1)
    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})
