import { describe, expect, it } from 'vitest'
import type { TranscriptItem } from '../../types'
import { selectActiveTranscriptLogs, selectThreadTranscriptLogs, selectVisibleTranscriptLogs } from './logSelectors'

describe('selectVisibleTranscriptLogs', () => {
  it('keeps warn/error logs and hides info logs', () => {
    const logs: TranscriptItem[] = [
      { id: 'm-1', kind: 'message', role: 'assistant', text: 'hello' },
      { id: 'l-1', kind: 'log', level: 'warn', text: 'warn log' },
      { id: 'l-2', kind: 'log', level: 'info', text: 'info log' },
      { id: 'l-3', kind: 'log', level: 'error', text: 'error log' },
    ]

    const filtered = selectVisibleTranscriptLogs(logs)
    expect(filtered).toHaveLength(3)
    expect(filtered.find((item) => item.id === 'l-2')).toBeUndefined()
    expect(filtered.find((item) => item.id === 'l-1')).toBeDefined()
    expect(filtered.find((item) => item.id === 'l-3')).toBeDefined()
  })

  it('returns the same array reference when no info logs are present', () => {
    const logs: TranscriptItem[] = [
      { id: 'm-1', kind: 'message', role: 'assistant', text: 'hello' },
      { id: 'l-1', kind: 'log', level: 'warn', text: 'warn log' },
    ]

    const filtered = selectVisibleTranscriptLogs(logs)
    expect(filtered).toBe(logs)
  })
})

describe('selectActiveTranscriptLogs', () => {
  it('prefers active thread cache logs and filters info logs', () => {
    const fallbackLogs: TranscriptItem[] = [
      { id: 'fallback-msg', kind: 'message', role: 'assistant', text: 'fallback' },
    ]
    const threadLogs: TranscriptItem[] = [
      { id: 'thread-info', kind: 'log', level: 'info', text: 'hidden info' },
      { id: 'thread-msg', kind: 'message', role: 'assistant', text: 'visible' },
    ]

    const selected = selectActiveTranscriptLogs({
      activeThreadId: 'thread-1',
      logs: fallbackLogs,
      logsByThreadId: { 'thread-1': threadLogs },
    })

    expect(selected).toEqual([{ id: 'thread-msg', kind: 'message', role: 'assistant', text: 'visible' }])
  })

  it('falls back to current logs when active thread has no cache entry', () => {
    const logs: TranscriptItem[] = [
      { id: 'm-1', kind: 'message', role: 'assistant', text: 'hello' },
      { id: 'l-1', kind: 'log', level: 'warn', text: 'warn log' },
    ]

    const selected = selectActiveTranscriptLogs({
      activeThreadId: 'thread-missing',
      logs,
      logsByThreadId: {},
    })

    expect(selected).toBe(logs)
  })
})

describe('selectThreadTranscriptLogs', () => {
  it('returns cached logs for matching thread', () => {
    const cachedLogs: TranscriptItem[] = [{ id: 'cached-1', kind: 'message', role: 'assistant', text: 'cached' }]
    const fallbackLogs: TranscriptItem[] = [{ id: 'fallback-1', kind: 'message', role: 'assistant', text: 'fallback' }]

    const selected = selectThreadTranscriptLogs({
      threadId: 'thread-1',
      logsByThreadId: { 'thread-1': cachedLogs },
      fallbackLogs,
    })

    expect(selected).toBe(cachedLogs)
  })

  it('falls back when thread is missing or null', () => {
    const fallbackLogs: TranscriptItem[] = [{ id: 'fallback-1', kind: 'message', role: 'assistant', text: 'fallback' }]

    const missingThread = selectThreadTranscriptLogs({
      threadId: 'thread-missing',
      logsByThreadId: {},
      fallbackLogs,
    })
    const nullThread = selectThreadTranscriptLogs({
      threadId: null,
      logsByThreadId: { 'thread-1': [] },
      fallbackLogs,
    })

    expect(missingThread).toBe(fallbackLogs)
    expect(nullThread).toBe(fallbackLogs)
  })
})
