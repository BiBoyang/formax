import { beforeEach, describe, expect, it, vi } from 'vitest'
const { execMock, existsSyncMock, createRuntimeFlagsMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  existsSyncMock: vi.fn(),
  createRuntimeFlagsMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  exec: execMock,
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}))

vi.mock('../../../../config/runtimeFlags', () => ({
  createRuntimeFlags: createRuntimeFlagsMock,
}))

import type { Msg } from '../../../../shared/toolMessageTypes'
import type { CanonicalEvent } from '../../../semantics/core/canonicalEvents'
import {
  applyLocalBashCompletionToMessages,
  createLocalBashCanonicalEmitter,
  formatBashModeOutput,
  isBashModeResultError,
  runBashModeCommand,
  runLocalBashTurn,
} from './bashMode'

async function withPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    return await run()
  } finally {
    Object.defineProperty(process, 'platform', { value: original })
  }
}

function mockExecOnce(args: {
  err?: any
  stdout?: string
  stderr?: string
  capture?: (command: string, options: Record<string, unknown>) => void
}) {
  execMock.mockImplementationOnce((command: string, options: Record<string, unknown>, cb: (...args: any[]) => void) => {
    args.capture?.(command, options)
    cb(args.err ?? null, args.stdout ?? '', args.stderr ?? '')
    return {} as any
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  existsSyncMock.mockReturnValue(false)
  createRuntimeFlagsMock.mockReturnValue({ userShellPath: undefined })
})

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

describe('formatBashModeOutput', () => {
  it('formats normal and error output variants', () => {
    expect(formatBashModeOutput({ stdout: '', stderr: '' })).toBe('(no output)')
    expect(formatBashModeOutput({ stdout: 'out', stderr: '' })).toBe('out')
    expect(formatBashModeOutput({ stdout: '', stderr: 'err' })).toBe('stderr:\nerr')
    expect(formatBashModeOutput({ stdout: 'out', stderr: 'err' })).toBe('stderr:\nerr\nstdout:\nout')

    expect(formatBashModeOutput({ stdout: '   ', stderr: '', timedOut: true })).toBe('Error: Timed out')
    expect(formatBashModeOutput({ stdout: 'out', stderr: 'err', exitCode: 2 })).toBe(
      'Error: Exit code 2\nstderr:\nerr\nstdout:\nout',
    )
    expect(formatBashModeOutput({ stdout: '', stderr: 'err', exitSignal: 'SIGTERM' })).toBe(
      'Error: Exit signal SIGTERM\nstderr:\nerr',
    )
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

  it('keeps non-running or non-tool rows unchanged', () => {
    const before: Msg[] = [
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: new Date(1),
        toolInfo: { name: 'LocalBash', input: { command: 'pwd' }, status: 'completed' },
      },
      { id: 'tool-2', role: 'assistant', content: 'x', timestamp: new Date(2) },
    ]

    const after = applyLocalBashCompletionToMessages({
      messages: before,
      messageId: 'tool-1',
      command: 'pwd',
      outputText: '/repo',
      isError: true,
    })

    expect(after).toEqual(before)
  })

  it('uses fallback toolInfo object when running row has transiently missing toolInfo', () => {
    let accessCount = 0
    const row: any = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(1),
    }
    Object.defineProperty(row, 'toolInfo', {
      configurable: true,
      get: () => {
        accessCount += 1
        return accessCount === 1 ? { status: 'running' } : undefined
      },
    })

    const after = applyLocalBashCompletionToMessages({
      messages: [row],
      messageId: 'tool-1',
      command: 'pwd',
      outputText: '/repo',
      isError: false,
    })

    expect(after[0]).toMatchObject({
      role: 'tool',
      content: '$ pwd',
      toolInfo: {
        name: 'LocalBash',
        input: { command: 'pwd' },
        status: 'completed',
        result: '/repo',
      },
    })
  })
})

describe('runBashModeCommand', () => {
  it('uses runtimeFlags shell, sanitizes output, and resolves success', async () => {
    let seenOptions: Record<string, unknown> | null = null
    existsSyncMock
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => true)

    mockExecOnce({
      stdout: '\u001b[31mok\r\nline\x07',
      stderr: '\u001b]0;title\u0007err\r',
      capture: (_command, options) => {
        seenOptions = options
      },
    })

    const result = await withPlatform('darwin', () =>
      runBashModeCommand({
        command: 'echo hi',
        cwd: '/repo',
        timeoutMs: 123,
        env: { FOO: 'bar' } as NodeJS.ProcessEnv,
        runtimeFlags: { userShellPath: '/custom/bash' } as any,
      }),
    )

    expect(result).toEqual({
      stdout: 'ok\nline',
      stderr: 'err\n',
      exitCode: 0,
      exitSignal: null,
      timedOut: false,
    })
    expect(seenOptions?.shell).toBe('/custom/bash')
    expect(seenOptions?.timeout).toBe(123)
    expect((seenOptions?.env as Record<string, unknown>)?.FOO).toBe('bar')
  })

  it('uses undefined shell on win32 and skips shell path probing', async () => {
    let seenOptions: Record<string, unknown> | null = null
    existsSyncMock.mockReturnValue(true)
    mockExecOnce({
      capture: (_command, options) => {
        seenOptions = options
      },
    })

    await withPlatform('win32', () =>
      runBashModeCommand({
        command: 'dir',
        cwd: 'C:\\repo',
        env: {} as NodeJS.ProcessEnv,
        runtimeFlags: { userShellPath: '/custom/bash' } as any,
      }),
    )

    expect(seenOptions?.shell).toBeUndefined()
    expect(existsSyncMock).not.toHaveBeenCalled()
  })

  it('creates runtime flags when missing and ignores existsSync probe errors', async () => {
    let seenOptions: Record<string, unknown> | null = null
    createRuntimeFlagsMock.mockReturnValueOnce({ userShellPath: '/generated/bash' })
    existsSyncMock
      .mockImplementationOnce(() => {
        throw new Error('fs-fail')
      })
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => true)

    mockExecOnce({
      capture: (_command, options) => {
        seenOptions = options
      },
    })

    const env = { BAR: 'baz' } as NodeJS.ProcessEnv
    await withPlatform('darwin', () =>
      runBashModeCommand({
        command: 'pwd',
        cwd: '/repo',
        env,
      }),
    )

    expect(createRuntimeFlagsMock).toHaveBeenCalledWith(env)
    expect(seenOptions?.shell).toBe('/generated/bash')
  })

  it('maps exec errors and clamps oversized output', async () => {
    const huge = 'x'.repeat(31_000)
    mockExecOnce({
      err: { code: 2, signal: null, killed: false },
      stdout: huge,
      stderr: 'stderr',
    })

    const result = await withPlatform('darwin', () =>
      runBashModeCommand({
        command: 'false',
        cwd: '/repo',
        env: {} as NodeJS.ProcessEnv,
        runtimeFlags: { userShellPath: undefined } as any,
      }),
    )

    expect(result.stdout.length).toBe(30_000)
    expect(result.stdout).toBe(huge.slice(huge.length - 30_000))
    expect(result.stderr).toBe('stderr')
    expect(result.exitCode).toBe(2)
    expect(result.exitSignal).toBeNull()
    expect(result.timedOut).toBe(false)
  })

  it('marks timeout for ETIMEDOUT and SIGTERM-killed cases', async () => {
    mockExecOnce({
      err: { code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true },
      stdout: '',
      stderr: '',
    })
    const fromCode = await withPlatform('darwin', () =>
      runBashModeCommand({
        command: 'sleep',
        cwd: '/repo',
        env: {} as NodeJS.ProcessEnv,
        runtimeFlags: { userShellPath: undefined } as any,
      }),
    )
    expect(fromCode.timedOut).toBe(true)
    expect(fromCode.exitCode).toBeNull()
    expect(fromCode.exitSignal).toBe('SIGTERM')

    mockExecOnce({
      err: { code: 1, signal: 'SIGTERM', killed: true },
      stdout: '',
      stderr: '',
    })
    const fromSignal = await withPlatform('darwin', () =>
      runBashModeCommand({
        command: 'sleep',
        cwd: '/repo',
        env: {} as NodeJS.ProcessEnv,
        runtimeFlags: { userShellPath: undefined } as any,
      }),
    )
    expect(fromSignal.timedOut).toBe(true)
    expect(fromSignal.exitCode).toBe(1)
    expect(fromSignal.exitSignal).toBe('SIGTERM')
  })

  it('does not mark timeout when caller signal was already aborted', async () => {
    const abort = new AbortController()
    abort.abort()
    mockExecOnce({
      err: { code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true },
      stdout: '',
      stderr: '',
    })

    const result = await withPlatform('darwin', () =>
      runBashModeCommand({
        command: 'sleep',
        cwd: '/repo',
        env: {} as NodeJS.ProcessEnv,
        runtimeFlags: { userShellPath: undefined } as any,
        signal: abort.signal,
      }),
    )

    expect(result.timedOut).toBe(false)
  })

  it('coerces missing command to empty string and falls back to process env', async () => {
    let seenCommand = ''
    let seenOptions: Record<string, unknown> | null = null
    createRuntimeFlagsMock.mockReturnValueOnce({ userShellPath: undefined })
    mockExecOnce({
      capture: (command, options) => {
        seenCommand = command
        seenOptions = options
      },
    })

    await withPlatform('darwin', () =>
      runBashModeCommand({
        command: undefined as any,
        cwd: '/repo',
      }),
    )

    expect(seenCommand).toBe('')
    expect(createRuntimeFlagsMock).toHaveBeenCalledWith(process.env)
    expect(seenOptions?.env).toEqual(expect.objectContaining(process.env))
  })
})

describe('runLocalBashTurn', () => {
  it('runs local bash command in canonical-only mode by default', async () => {
    const events: CanonicalEvent[] = []
    let replaySeq = 0
    let messages: Msg[] = []
    const pendingInjectedBlocksRef = { current: [] as any[] }
    const abortControllerRef: { current: AbortController | null } = { current: null }
    const clearCanonicalTransientState = vi.fn()

    const outcome = await runLocalBashTurn({
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

    expect(outcome).toBe('completed')
    expect(messages).toEqual([])
    expect(pendingInjectedBlocksRef.current.length).toBeGreaterThan(0)
    expect(events.map((event) => event.kind)).toEqual([
      'user_message',
      'tool_event',
      'tool_event',
      'tool_event',
      'turn_footer',
    ])
    const startEvent = events.find((event): event is CanonicalEvent & { kind: 'tool_event'; phase: 'start' } =>
      event.kind === 'tool_event' && event.phase === 'start',
    )
    expect(startEvent?.input).toEqual({ command: 'pwd' })
    expect(startEvent?.paramsText).toBe('command="pwd"')
    const endEvent = events.find((event): event is CanonicalEvent & { kind: 'tool_event'; phase: 'end' } =>
      event.kind === 'tool_event' && event.phase === 'end',
    )
    expect(endEvent?.result).toContain('/repo')
    expect(abortControllerRef.current).toBeNull()
    expect(clearCanonicalTransientState).toHaveBeenCalledTimes(1)
  })

  it('can still write legacy tool rows when explicitly enabled', async () => {
    let messages: Msg[] = []

    const outcome = await runLocalBashTurn({
      command: 'pwd',
      cwd: '/repo',
      env: process.env,
      runtimeFlags: { userShellPath: undefined } as any,
      threadId: 'tui-live',
      turnId: 'local-bash-legacy',
      nextReplaySeq: (() => {
        let replaySeq = 0
        return () => {
          replaySeq += 1
          return replaySeq
        }
      })(),
      onCanonicalEvent: () => {},
      setMessages: (updater: any) => {
        messages = typeof updater === 'function' ? updater(messages) : updater
      },
      writeLegacyTranscriptRows: true,
      pendingInjectedBlocksRef: { current: [] } as any,
      abortControllerRef: { current: null },
      clearCanonicalTransientState: vi.fn(),
      runCommand: async () => ({
        stdout: '/repo\n',
        stderr: '',
        exitCode: 0,
        exitSignal: null,
        timedOut: false,
      }),
    })

    expect(outcome).toBe('completed')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: 'tool',
      content: '$ pwd',
      toolInfo: { name: 'LocalBash', status: 'completed' },
    })
    expect((messages[0]?.toolInfo?.result || '').includes('/repo')).toBe(true)
  })

  it('returns failed and writes error state when bash exits with failure', async () => {
    const events: CanonicalEvent[] = []
    let replaySeq = 0
    let messages: Msg[] = []

    const outcome = await runLocalBashTurn({
      command: 'false',
      cwd: '/repo',
      env: process.env,
      runtimeFlags: { userShellPath: undefined } as any,
      threadId: 'tui-live',
      turnId: 'local-bash-fail',
      nextReplaySeq: () => {
        replaySeq += 1
        return replaySeq
      },
      onCanonicalEvent: (event) => events.push(event),
      setMessages: (updater: any) => {
        messages = typeof updater === 'function' ? updater(messages) : updater
      },
      writeLegacyTranscriptRows: true,
      pendingInjectedBlocksRef: { current: [] } as any,
      abortControllerRef: { current: null },
      clearCanonicalTransientState: vi.fn(),
      runCommand: async () => ({
        stdout: '',
        stderr: 'oops',
        exitCode: 2,
        exitSignal: null,
        timedOut: false,
      }),
    })

    expect(outcome).toBe('failed')
    expect(messages[0]).toMatchObject({
      role: 'tool',
      content: '$ false',
      toolInfo: { name: 'LocalBash', status: 'error' },
    })
    const endEvent = events.find((event): event is CanonicalEvent & { kind: 'tool_event'; phase: 'end' } =>
      event.kind === 'tool_event' && event.phase === 'end',
    )
    expect(endEvent?.isError).toBe(true)
    const footerEvent = events.find((event): event is CanonicalEvent & { kind: 'turn_footer' } =>
      event.kind === 'turn_footer',
    )
    expect(footerEvent?.status).toBe('failed')
  })

  it('falls back to runBashModeCommand when runCommand is not provided', async () => {
    const events: CanonicalEvent[] = []
    let replaySeq = 0
    existsSyncMock.mockImplementationOnce(() => true)
    mockExecOnce({
      stdout: '/repo\n',
      stderr: '',
    })

    const outcome = await runLocalBashTurn({
      command: 'pwd',
      cwd: '/repo',
      env: process.env,
      runtimeFlags: { userShellPath: '/bin/bash' } as any,
      threadId: 'tui-live',
      turnId: 'local-bash-default-run',
      nextReplaySeq: () => {
        replaySeq += 1
        return replaySeq
      },
      onCanonicalEvent: (event) => events.push(event),
      setMessages: vi.fn() as any,
      pendingInjectedBlocksRef: { current: [] } as any,
      abortControllerRef: { current: null },
      clearCanonicalTransientState: vi.fn(),
    })

    expect(outcome).toBe('completed')
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.kind === 'tool_event')).toBe(true)
  })

  it('returns aborted if local bash aborts before completion', async () => {
    const events: CanonicalEvent[] = []
    let replaySeq = 0
    const abortControllerRef: { current: AbortController | null } = { current: null }
    const clearCanonicalTransientState = vi.fn()

    const outcome = await runLocalBashTurn({
      command: 'sleep 999',
      cwd: '/repo',
      env: process.env,
      runtimeFlags: { userShellPath: undefined } as any,
      threadId: 'tui-live',
      turnId: 'local-bash-abort',
      nextReplaySeq: () => {
        replaySeq += 1
        return replaySeq
      },
      onCanonicalEvent: (event) => events.push(event),
      setMessages: vi.fn() as any,
      pendingInjectedBlocksRef: { current: [] } as any,
      abortControllerRef,
      clearCanonicalTransientState,
      runCommand: async () => {
        abortControllerRef.current?.abort()
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          exitSignal: null,
          timedOut: false,
        }
      },
    })

    expect(outcome).toBe('aborted')
    expect(abortControllerRef.current).toBeNull()
    const footerEvent = events.find((event): event is CanonicalEvent & { kind: 'turn_footer' } =>
      event.kind === 'turn_footer',
    )
    expect(footerEvent?.status).toBe('interrupted')
    expect((footerEvent as any)?.message).toBe('Request aborted')
    expect(clearCanonicalTransientState).toHaveBeenCalledTimes(1)
  })

  it('does not clear abort ref when a newer controller replaces it', async () => {
    const newer = new AbortController()
    const abortControllerRef: { current: AbortController | null } = { current: null }

    await runLocalBashTurn({
      command: 'pwd',
      cwd: '/repo',
      env: process.env,
      runtimeFlags: { userShellPath: undefined } as any,
      threadId: 'tui-live',
      turnId: 'local-bash-replaced',
      nextReplaySeq: (() => {
        let replaySeq = 0
        return () => {
          replaySeq += 1
          return replaySeq
        }
      })(),
      onCanonicalEvent: vi.fn(),
      setMessages: vi.fn() as any,
      pendingInjectedBlocksRef: { current: [] } as any,
      abortControllerRef,
      clearCanonicalTransientState: vi.fn(),
      runCommand: async () => {
        abortControllerRef.current = newer
        return {
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          exitSignal: null,
          timedOut: false,
        }
      },
    })

    expect(abortControllerRef.current).toBe(newer)
  })
})
