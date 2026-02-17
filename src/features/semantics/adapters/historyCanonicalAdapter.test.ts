import { describe, expect, it } from 'vitest'
import { toCanonicalEventsFromHistoryMessages, type HistoryCanonicalMessage } from './historyCanonicalAdapter'

describe('historyCanonicalAdapter', () => {
  it('maps assistant and tool history rows into canonical events with monotonic replaySeq', () => {
    const messages: HistoryCanonicalMessage[] = [
      { id: 'u1', kind: 'message', role: 'user', text: 'hello' },
      { id: 'a1', kind: 'message', role: 'assistant', text: 'world' },
      {
        id: 't1',
        kind: 'tool',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        status: 'completed',
        summary: 'done',
        detailLines: ['line-1', 'line-2'],
      },
    ]

    const events = toCanonicalEventsFromHistoryMessages({ threadId: 'thread-1', messages })

    expect(events.map((event) => event.kind)).toEqual(['assistant_delta', 'tool_event', 'tool_event', 'tool_event', 'tool_event'])
    expect(events.map((event) => event.replaySeq)).toEqual([1, 2, 3, 4, 5])
    expect(events.map((event) => event.eventId)).toEqual([
      'history:thread-1:a1:assistant:1',
      'history:thread-1:t1:tool_start:2',
      'history:thread-1:t1:tool_update:3',
      'history:thread-1:t1:tool_update:4',
      'history:thread-1:t1:tool_end:5',
    ])
  })

  it('falls back toolUseId and marks error status at tool_end', () => {
    const messages: HistoryCanonicalMessage[] = [
      {
        id: 't1',
        kind: 'tool',
        toolName: 'Write',
        status: 'error',
        summary: 'permission denied',
      },
    ]
    const events = toCanonicalEventsFromHistoryMessages({ threadId: 'thread-2', messages })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      kind: 'tool_event',
      phase: 'start',
      toolUseId: 'thread-2:t1',
      toolName: 'Write',
    })
    expect(events[1]).toMatchObject({
      kind: 'tool_event',
      phase: 'end',
      isError: true,
      summary: 'permission denied',
    })
  })
})
