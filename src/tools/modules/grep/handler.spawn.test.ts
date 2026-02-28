import { describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'

type SpawnPlan = {
  stderrText?: string
  stdoutText?: string
  errorMessage?: string
  closeCode?: number | null
}

async function runWithMockedSpawn(plan: SpawnPlan) {
  vi.resetModules()
  vi.doMock('node:child_process', () => {
    return {
      spawn: () => {
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        const listeners = new Map<string, Array<(...args: any[]) => void>>()
        const on = (event: string, cb: (...args: any[]) => void) => {
          const arr = listeners.get(event) ?? []
          arr.push(cb)
          listeners.set(event, arr)
        }

        queueMicrotask(() => {
          if (plan.stdoutText) stdout.write(plan.stdoutText)
          if (plan.stderrText) stderr.write(plan.stderrText)
          if (plan.errorMessage !== undefined) {
            const err = new Error(plan.errorMessage)
            for (const cb of listeners.get('error') ?? []) cb(err)
          } else {
            const code = plan.closeCode === undefined ? 0 : plan.closeCode
            for (const cb of listeners.get('close') ?? []) cb(code)
          }
        })

        return {
          stdout,
          stderr,
          on,
        }
      },
    }
  })

  const { createGrepToolHandler } = await import('./handler')
  const handler = createGrepToolHandler({
    resolveExecutable: async () => '/mock/rg',
  })

  return await handler.execute(
    { id: 'spawn', name: 'Grep', input: { pattern: 'foo' } } as any,
    { cwd: '/repo', agentDepth: 0 },
  )
}

describe('createGrepToolHandler spawn branches', () => {
  it('uses stderr text when spawn error has empty message', async () => {
    const result = await runWithMockedSpawn({
      stderrText: 'stderr from process',
      errorMessage: '',
    })

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('stderr from process')
  })

  it('uses fallback text when spawn error has empty message and no stderr', async () => {
    const result = await runWithMockedSpawn({
      errorMessage: '',
    })

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Failed to execute /mock/rg')
  })

  it('maps close(null) to exitCode -1 branch', async () => {
    const result = await runWithMockedSpawn({
      stdoutText: 'x\n',
      closeCode: null,
    })

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('ripgrep failed (-1)')
  })
})
