import { describe, expect, it } from 'vitest'
import { toCanonicalEventsFromStreamEvent } from './streamCanonicalAdapter'

describe('streamCanonicalAdapter', () => {
  it('maps stream events to canonical events with stable sequencing', () => {
    let replaySeq = 0
    const nextReplaySeq = () => {
      replaySeq += 1
      return replaySeq
    }
    const ctx = {
      threadId: 'tui-live',
      turnId: 'turn-1',
      nextReplaySeq,
      now: () => '2026-02-13T00:00:00.000Z',
    }

    const events = [
      ...toCanonicalEventsFromStreamEvent({ type: 'thinking_delta', thinking: 'hmm' }, ctx),
      ...toCanonicalEventsFromStreamEvent({ type: 'assistant_delta', text: 'hello' }, ctx),
      ...toCanonicalEventsFromStreamEvent({ type: 'tool_start', id: 'tool-1', name: 'Bash' }, ctx),
      ...toCanonicalEventsFromStreamEvent({ type: 'tool_input', id: 'tool-1', input: { command: 'ls -la' } }, ctx),
      ...toCanonicalEventsFromStreamEvent(
        { type: 'tool_update', id: 'tool-1', middleLines: ['OUT total 1'], transcriptLines: [] },
        ctx,
      ),
      ...toCanonicalEventsFromStreamEvent(
        { type: 'tool_end', id: 'tool-1', result: { content: 'ok', is_error: false, tool_use_id: 'tool-1' } },
        ctx,
      ),
      ...toCanonicalEventsFromStreamEvent({ type: 'complete' }, ctx),
    ]

    expect(events.map((event) => event.kind)).toEqual([
      'thinking_delta',
      'assistant_delta',
      'tool_event',
      'tool_event',
      'tool_event',
      'tool_event',
      'thinking_finalized',
      'turn_footer',
    ])
    expect(events.map((event) => event.replaySeq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(events[2]).toMatchObject({
      kind: 'tool_event',
      toolUseId: 'tool-1',
      phase: 'start',
      toolName: 'Bash',
    })
    expect(events[events.length - 1]).toMatchObject({
      kind: 'turn_footer',
      status: 'completed',
    })
  })

  it('maps stream errors to failed turn footer', () => {
    let replaySeq = 0
    const events = toCanonicalEventsFromStreamEvent(
      { type: 'error', error: new Error('boom') },
      {
        threadId: 'tui-live',
        turnId: 'turn-error',
        nextReplaySeq: () => {
          replaySeq += 1
          return replaySeq
        },
      },
    )

    expect(events.map((event) => event.kind)).toEqual(['thinking_finalized', 'turn_footer'])
    expect(events[1]).toMatchObject({
      kind: 'turn_footer',
      status: 'failed',
      message: 'boom',
    })
  })
})
