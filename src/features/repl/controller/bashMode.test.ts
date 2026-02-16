import { describe, expect, it } from 'vitest'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { CanonicalEvent } from '../../semantics/canonicalEvents'
import {
  applyLocalBashCompletionToMessages,
  createLocalBashCanonicalEmitter,
  isBashModeResultError,
} from './bashMode'

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

describe('isBashModeResultError', () => {
  it('returns true for timeout/exit-signal/nonzero exitCode', () => {
    expect(
      isBashModeResultError({ stdout: '', stderr: '', exitCode: 0, exitSignal: null, timedOut: true }),
    ).toBe(true)
    expect(
      isBashModeResultError({ stdout: '', stderr: '', exitCode: null, exitSignal: 'SIGTERM', timedOut: false }),
    ).toBe(true)
    expect(
      isBashModeResultError({ stdout: '', stderr: '', exitCode: 2, exitSignal: null, timedOut: false }),
    ).toBe(true)
    expect(
      isBashModeResultError({ stdout: '', stderr: '', exitCode: 0, exitSignal: null, timedOut: false }),
    ).toBe(false)
  })
})

describe('applyLocalBashCompletionToMessages', () => {
  it('updates only the running LocalBash tool row', () => {
    const before: Msg[] = [
      { id: 'u1', role: 'user', content: '! pwd', timestamp: new Date(1) },
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: new Date(2),
        toolInfo: { name: 'LocalBash', input: { command: 'pwd' }, status: 'running' },
      },
      {
        id: 'tool-2',
        role: 'tool',
        content: '',
        timestamp: new Date(3),
        toolInfo: { name: 'Read', input: { file_path: 'a' }, status: 'running' },
      },
    ]

    const after = applyLocalBashCompletionToMessages({
      messages: before,
      messageId: 'tool-1',
      command: 'pwd',
      outputText: '/repo',
      isError: false,
    })

    expect(after[1]).toMatchObject({
      id: 'tool-1',
      content: '$ pwd',
      toolInfo: {
        name: 'LocalBash',
        status: 'completed',
        result: '/repo',
      },
    })
    expect(after[2]).toBe(before[2])
  })
})
