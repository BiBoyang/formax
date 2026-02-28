import { describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'

type SpawnPlan = {
  emitError?: string
  emitCloseAfterError?: boolean
  pid?: number | undefined
  emitStdoutBursts?: string[]
  closeCode?: number | null
  closeSignal?: NodeJS.Signals | null
  throwOnKill?: boolean
}

async function loadHandlerWithSpawnPlan(plan: SpawnPlan) {
  vi.resetModules()
  vi.doMock('node:child_process', () => {
    return {
      exec: (_cmd: string, _opts: any, cb: (err: any, stdout: string, stderr: string) => void) => {
        cb(null, '', '')
      },
      spawn: () => {
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        const listeners = new Map<string, Array<(...args: any[]) => void>>()
        const on = (event: string, cb: (...args: any[]) => void) => {
          const arr = listeners.get(event) ?? []
          arr.push(cb)
          listeners.set(event, arr)
        }
        const child = {
          stdout,
          stderr,
          on,
          pid: plan.pid === undefined ? 12345 : plan.pid,
          kill: () => {
            if (plan.throwOnKill) throw new Error('kill failed')
            return true
          },
        }

        queueMicrotask(() => {
          if (plan.emitStdoutBursts) {
            for (const chunk of plan.emitStdoutBursts) {
              stdout.write(chunk)
            }
          }
          if (plan.emitError != null) {
            const err = new Error(plan.emitError)
            for (const cb of listeners.get('error') ?? []) cb(err)
            if (plan.emitCloseAfterError) {
              for (const cb of listeners.get('close') ?? []) cb(plan.closeCode ?? 0, plan.closeSignal ?? null)
            }
            return
          }
          for (const cb of listeners.get('close') ?? []) cb(plan.closeCode ?? 0, plan.closeSignal ?? null)
        })

        return child as any
      },
    }
  })

  return await import('./handler')
}

describe('BashToolHandler spawn branches', () => {
  it('returns background task error when spawn emits error', async () => {
    const { createBashToolHandler } = await loadHandlerWithSpawnPlan({
      emitError: 'spawn fail',
      emitCloseAfterError: true,
    })
    const taskStore = new Map<string, Promise<any>>()
    const fakeTaskManager = {
      create: ({ run }: any) => {
        const ac = new AbortController()
        const promise = run({
          id: 't1',
          signal: ac.signal,
          updateResult: () => {},
          setCancel: () => {},
        })
        taskStore.set('t1', promise)
        return 't1'
      },
    } as any

    const handler = createBashToolHandler({ taskManager: fakeTaskManager })
    const res = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'echo x', run_in_background: true } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(res.is_error).toBeUndefined()
    const bg = await taskStore.get('t1')!
    expect(bg.is_error).toBe(true)
    expect(bg.content).toContain('spawn fail')
  })

  it('kills immediately when background signal is already aborted', async () => {
    const { createBashToolHandler } = await loadHandlerWithSpawnPlan({ pid: 0 })
    const taskStore = new Map<string, Promise<any>>()
    const fakeTaskManager = {
      create: ({ run }: any) => {
        const ac = new AbortController()
        ac.abort()
        const promise = run({
          id: 't2',
          signal: ac.signal,
          updateResult: () => {},
          setCancel: () => {},
        })
        taskStore.set('t2', promise)
        return 't2'
      },
    } as any

    const handler = createBashToolHandler({ taskManager: fakeTaskManager })
    const res = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'echo x', run_in_background: true } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(res.is_error).toBeUndefined()
    const bg = await taskStore.get('t2')!
    expect(bg.is_error).toBe(true)
    expect(bg.content).toContain('Killed')
  })

  it('handles timeout=0 without scheduling timer and flushes throttled updates once', async () => {
    const { createBashToolHandler } = await loadHandlerWithSpawnPlan({
      emitStdoutBursts: ['a', 'b'],
      closeCode: 0,
      closeSignal: null,
    })
    let updateCount = 0
    let lastContent = ''
    const taskStore = new Map<string, Promise<any>>()
    const fakeTaskManager = {
      create: ({ run }: any) => {
        const ac = new AbortController()
        const promise = run({
          id: 't3',
          signal: ac.signal,
          updateResult: (next: any) => {
            updateCount += 1
            lastContent = String(next?.content ?? '')
          },
          setCancel: () => {},
        })
        taskStore.set('t3', promise)
        return 't3'
      },
    } as any

    const handler = createBashToolHandler({ taskManager: fakeTaskManager })
    const res = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'echo x', run_in_background: true, timeout: 0 } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(res.is_error).toBeUndefined()
    const bg = await taskStore.get('t3')!
    expect(bg.is_error).not.toBe(true)
    expect(bg.content).toContain('ab')
    expect(updateCount).toBeGreaterThanOrEqual(1)
    expect(lastContent).toContain('ab')
  })

  it('swallows child.kill errors when process-tree termination fallback fails', async () => {
    const { createBashToolHandler } = await loadHandlerWithSpawnPlan({ pid: 12345, throwOnKill: true })
    const taskStore = new Map<string, Promise<any>>()
    const fakeTaskManager = {
      create: ({ run }: any) => {
        const ac = new AbortController()
        ac.abort()
        const promise = run({
          id: 't4',
          signal: ac.signal,
          updateResult: () => {},
          setCancel: () => {},
        })
        taskStore.set('t4', promise)
        return 't4'
      },
    } as any

    const handler = createBashToolHandler({ taskManager: fakeTaskManager })
    const res = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'echo x', run_in_background: true } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(res.is_error).toBeUndefined()
    const bg = await taskStore.get('t4')!
    expect(bg.is_error).toBe(true)
    expect(bg.content).toContain('Killed')
  })
})
