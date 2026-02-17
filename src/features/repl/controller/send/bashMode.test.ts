import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import type { CanonicalEvent } from '../../../semantics/canonicalEvents'
import {
  applyLocalBashCompletionToMessages,
  createLocalBashCanonicalEmitter,
  isBashModeResultError,
  runLocalBashTurn,
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

describe('runLocalBashTurn', () => {
  it('runs local bash command, emits canonical events, updates message, and injects blocks', async () => {
    const events: CanonicalEvent[] = []
    let replaySeq = 0
    let messages: Msg[] = []
    const pendingInjectedBlocksRef = { current: [] as any[] }
    const abortControllerRef: { current: AbortController | null } = { current: null }
    const clearCanonicalTransientState = vi.fn()

    await runLocalBashTurn({
      command: 'pwd',
      cwd: '/repo',
      env: process.env,
      runtimeFlags: { userShellPath: undefined } as any,
      threadId: 'tui-live',
      turnId: 'local-bash-1',
      nextReplaySeq: () => {
        replaySeq += 1
        return replaySeq
      },
      onCanonicalEvent: (event) => events.push(event),
      setMessages: (updater: any) => {
        messages = typeof updater === 'function' ? updater(messages) : updater
      },
      pendingInjectedBlocksRef: pendingInjectedBlocksRef as any,
      abortControllerRef,
      clearCanonicalTransientState,
      runCommand: async () => ({
        stdout: '/repo\n',
        stderr: '',
        exitCode: 0,
        exitSignal: null,
        timedOut: false,
      }),
    })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: 'tool',
      content: '$ pwd',
      toolInfo: { name: 'LocalBash', status: 'completed' },
    })
    expect((messages[0]?.toolInfo?.result || '').includes('/repo')).toBe(true)
    expect(pendingInjectedBlocksRef.current.length).toBeGreaterThan(0)
    expect(events.map((event) => event.kind)).toEqual([
      'user_message',
      'tool_event',
      'tool_event',
      'tool_event',
      'turn_footer',
    ])
    expect(abortControllerRef.current).toBeNull()
    expect(clearCanonicalTransientState).toHaveBeenCalledTimes(1)
  })
})
