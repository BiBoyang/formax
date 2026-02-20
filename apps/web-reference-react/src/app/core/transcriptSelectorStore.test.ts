import { describe, expect, it, vi } from 'vitest'
import type { TranscriptItem } from '../../types'
import { selectActiveTranscriptLogs } from './logSelectors'
import { createTranscriptSelectorStore } from './transcriptSelectorStore'

describe('transcriptSelectorStore', () => {
  it('caches selector results when snapshot references are unchanged', () => {
    const store = createTranscriptSelectorStore()
    const selector = vi.fn((snapshot: {
      activeThreadId: string | null
      logs: TranscriptItem[]
      logsByThreadId: Record<string, TranscriptItem[]>
    }) => selectActiveTranscriptLogs(snapshot))

    const logs: TranscriptItem[] = [{ id: 'm1', kind: 'message', role: 'assistant', text: 'hello' }]
    const logsByThreadId: Record<string, TranscriptItem[]> = {}
    const snapshot = { activeThreadId: null, logs, logsByThreadId }

    const first = store.select(selector, snapshot)
    const second = store.select(selector, snapshot)

    expect(selector).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('recomputes when snapshot references change and keeps selector semantics', () => {
    const store = createTranscriptSelectorStore()
    const selector = vi.fn((snapshot: {
      activeThreadId: string | null
      logs: TranscriptItem[]
      logsByThreadId: Record<string, TranscriptItem[]>
    }) => selectActiveTranscriptLogs(snapshot))

    const fallbackLogs: TranscriptItem[] = [{ id: 'fallback', kind: 'message', role: 'assistant', text: 'fallback' }]
    const threadLogs: TranscriptItem[] = [
      { id: 'info', kind: 'log', level: 'info', text: 'hidden' },
      { id: 'visible', kind: 'message', role: 'assistant', text: 'visible' },
    ]
    const first = store.select(selector, {
      activeThreadId: null,
      logs: fallbackLogs,
      logsByThreadId: {},
    })
    const second = store.select(selector, {
      activeThreadId: 'thread-1',
      logs: fallbackLogs,
      logsByThreadId: { 'thread-1': threadLogs },
    })

    expect(selector).toHaveBeenCalledTimes(2)
    expect(first).toBe(fallbackLogs)
    expect(second).toEqual([{ id: 'visible', kind: 'message', role: 'assistant', text: 'visible' }])
  })

  it('clears cache entries', () => {
    const store = createTranscriptSelectorStore()
    const selector = vi.fn((snapshot: {
      activeThreadId: string | null
      logs: TranscriptItem[]
      logsByThreadId: Record<string, TranscriptItem[]>
    }) => selectActiveTranscriptLogs(snapshot))
    const logs: TranscriptItem[] = [{ id: 'm1', kind: 'message', role: 'assistant', text: 'hello' }]
    const snapshot = { activeThreadId: null, logs, logsByThreadId: {} }

    store.select(selector, snapshot)
    store.clear()
    store.select(selector, snapshot)

    expect(selector).toHaveBeenCalledTimes(2)
  })
})
