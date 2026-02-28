import { describe, expect, it, vi } from 'vitest'

async function loadHandlerWithExecError(execError: any) {
  vi.resetModules()
  vi.doMock('node:child_process', () => {
    return {
      exec: (_cmd: string, _opts: any, cb: (err: any, stdout: string, stderr: string) => void) => {
        cb(execError, '', '')
      },
      spawn: () => {
        throw new Error('spawn should not be used in foreground tests')
      },
    }
  })
  return await import('./handler')
}

describe('BashToolHandler foreground error branches', () => {
  it('uses default input/cwd fallbacks and supports description label branch', async () => {
    const { createBashToolHandler } = await import('./handler')
    const fakeTaskManager = {
      create: ({ label }: any) => {
        expect(label).toBe('my task')
        return 'task-1'
      },
    } as any
    const handler = createBashToolHandler({ taskManager: fakeTaskManager })

    const result = await handler.execute(
      { id: '1', name: 'Bash', input: null } as any,
      { agentDepth: 0, replMode: 'normal' } as any,
    )
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Missing command')

    const bgResult = await handler.execute(
      { id: '2', name: 'Bash', input: { command: 'echo hi', run_in_background: true, description: ' my task ' } } as any,
      { agentDepth: 0, replMode: 'normal' } as any,
    )
    expect(bgResult.is_error).toBeUndefined()
  })

  it('handles non-Error exceptions thrown before command execution', async () => {
    const { createBashToolHandler } = await import('./handler')
    const handler = createBashToolHandler({
      taskManager: { create: () => 'unused' } as any,
    })
    const call = { id: '1', name: 'Bash' } as any
    Object.defineProperty(call, 'input', {
      get() {
        throw 'input-getter-failed'
      },
    })

    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' })
    expect(result.is_error).toBe(true)
    expect(result.content).toBe('Error: input-getter-failed')
  })

  it('maps foreground timeout/error headline branches deterministically', async () => {
    const timeoutErr = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT', killed: false, signal: null })
    const { createBashToolHandler: createTimeout } = await loadHandlerWithExecError(timeoutErr)
    const timeoutHandler = createTimeout({ taskManager: { create: () => 'unused' } as any })
    const timeoutResult = await timeoutHandler.execute(
      { id: '1', name: 'Bash', input: { command: 'echo hi' } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(timeoutResult.is_error).toBe(true)
    expect(timeoutResult.content).toContain('Timed out after')

    const maxBufferErr = Object.assign(new Error('max buffer'), {
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      killed: false,
      signal: null,
    })
    const { createBashToolHandler: createMaxBuffer } = await loadHandlerWithExecError(maxBufferErr)
    const maxBufferHandler = createMaxBuffer({ taskManager: { create: () => 'unused' } as any })
    const maxBufferResult = await maxBufferHandler.execute(
      { id: '2', name: 'Bash', input: { command: 'echo hi' } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(maxBufferResult.is_error).toBe(true)
    expect(maxBufferResult.content).toContain('Output exceeded exec maxBuffer')

    const signalErr = Object.assign(new Error('signal exit'), { code: 'X', killed: false, signal: 'SIGKILL' })
    const { createBashToolHandler: createSignal } = await loadHandlerWithExecError(signalErr)
    const signalHandler = createSignal({ taskManager: { create: () => 'unused' } as any })
    const signalResult = await signalHandler.execute(
      { id: '3', name: 'Bash', input: { command: 'echo hi' } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(signalResult.is_error).toBe(true)
    expect(signalResult.content).toContain('Exit signal SIGKILL')

    const nonTimeoutSignalErr = Object.assign(new Error('other signal'), {
      code: undefined,
      killed: true,
      signal: 'SIGINT',
    })
    const { createBashToolHandler: createNonTimeoutSignal } = await loadHandlerWithExecError(nonTimeoutSignalErr)
    const nonTimeoutSignalHandler = createNonTimeoutSignal({ taskManager: { create: () => 'unused' } as any })
    const nonTimeoutSignalResult = await nonTimeoutSignalHandler.execute(
      { id: '3b', name: 'Bash', input: { command: 'echo hi' } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(nonTimeoutSignalResult.is_error).toBe(true)
    expect(nonTimeoutSignalResult.content).toContain('Exit signal SIGINT')

    const rawErr = 'raw-failure'
    const { createBashToolHandler: createRaw } = await loadHandlerWithExecError(rawErr)
    const rawHandler = createRaw({ taskManager: { create: () => 'unused' } as any })
    const rawResult = await rawHandler.execute(
      { id: '4', name: 'Bash', input: { command: 'echo hi' } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(rawResult.is_error).toBe(true)
    expect(rawResult.content).toContain('Error: raw-failure')
  })
})
