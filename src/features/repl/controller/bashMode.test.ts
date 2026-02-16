import { describe, expect, it } from 'vitest'
import type { CanonicalEvent } from '../../semantics/canonicalEvents'
import { createLocalBashCanonicalEmitter } from './bashMode'

describe('createLocalBashCanonicalEmitter', () => {
  it('emits canonical user/tool/footer events with stable ids and replay sequence', () => {
    const events: CanonicalEvent[] = []
    let seq = 0
    const emitter = createLocalBashCanonicalEmitter({
      threadId: 'tui-live',
      turnId: 'local-bash-1',
      toolUseId: 'tool-123',
      onCanonicalEvent: (event) => events.push(event),
      nextReplaySeq: () => {
        seq += 1
        return seq
      },
      nowIso: () => '2026-02-16T00:00:00.000Z',
    })

    emitter.emitUserMessage('pwd')
    emitter.emitToolEvent({ phase: 'start' })
    emitter.emitToolEvent({ phase: 'update', line: '$ pwd' })
    emitter.emitToolEvent({ phase: 'end', summary: '/repo', isError: false })
    emitter.emitFooter('completed')

    expect(events.map((event) => event.kind)).toEqual([
      'user_message',
      'tool_event',
      'tool_event',
      'tool_event',
      'turn_footer',
    ])
    expect(events.map((event) => event.replaySeq)).toEqual([1, 2, 3, 4, 5])
    expect(events.map((event) => event.eventId)).toEqual([
      'tui-live:local-bash-1:user_message:1',
      'tui-live:local-bash-1:tool_event:2',
      'tui-live:local-bash-1:tool_event:3',
      'tui-live:local-bash-1:tool_event:4',
      'tui-live:local-bash-1:turn_footer:5',
    ])
    const userMessage = events[0]
    expect(userMessage && userMessage.kind === 'user_message' ? userMessage.text : '').toBe('! pwd')
    const endToolEvent = events[3]
    expect(endToolEvent && endToolEvent.kind === 'tool_event' ? endToolEvent.summary : '').toBe('/repo')
  })
})
