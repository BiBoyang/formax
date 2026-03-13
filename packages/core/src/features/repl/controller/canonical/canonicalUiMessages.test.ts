import { describe, expect, it } from 'vitest'
import type { CanonicalEvent } from '../../../semantics/core/canonicalEvents'
import { emitCanonicalUiMessageForTurn } from './canonicalUiMessages'

function captureEvents(): {
  events: CanonicalEvent[]
  onCanonicalEvent: (event: CanonicalEvent) => void
} {
  const events: CanonicalEvent[] = []
  return {
    events,
    onCanonicalEvent: (event) => {
      events.push(event)
    },
  }
}

describe('canonicalUiMessages', () => {
  it('emits user_message for plain user ui message', () => {
    const { events, onCanonicalEvent } = captureEvents()
    emitCanonicalUiMessageForTurn({
      threadId: 'tui-live',
      turnId: 'turn-1',
      message: { role: 'user', content: '/compact' },
      nextReplaySeq: () => 1,
      onCanonicalEvent,
      nowIso: () => '2026-02-16T00:00:00.000Z',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'user_message',
      threadId: 'tui-live',
      turnId: 'turn-1',
      replaySeq: 1,
      eventId: 'tui-live:turn-1:user_message:1',
      text: '/compact',
    })
  })

  it('emits user_message for compact_summary user message', () => {
    const { events, onCanonicalEvent } = captureEvents()
    emitCanonicalUiMessageForTurn({
      threadId: 'tui-live',
      turnId: 'turn-2',
      message: { role: 'user', content: 'summary', uiKind: 'compact_summary' },
      nextReplaySeq: () => 2,
      onCanonicalEvent,
      nowIso: () => '2026-02-16T00:00:01.000Z',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'user_message',
      threadId: 'tui-live',
      turnId: 'turn-2',
      replaySeq: 2,
      eventId: 'tui-live:turn-2:user_message:2',
      text: 'summary',
      uiKind: 'compact_summary',
    })
  })

  it('emits system_message for assistant ui message', () => {
    const { events, onCanonicalEvent } = captureEvents()
    emitCanonicalUiMessageForTurn({
      threadId: 'tui-live',
      turnId: 'turn-3',
      message: { role: 'assistant', content: 'Compacted', uiKind: 'command_subline' },
      nextReplaySeq: () => 3,
      onCanonicalEvent,
      nowIso: () => '2026-02-16T00:00:02.000Z',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'system_message',
      threadId: 'tui-live',
      turnId: 'turn-3',
      replaySeq: 3,
      eventId: 'tui-live:turn-3:system_message:3',
      role: 'assistant',
      text: 'Compacted',
      uiKind: 'command_subline',
    })
  })
})
