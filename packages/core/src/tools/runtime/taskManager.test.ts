import { describe, it, expect } from 'vitest'
import { TaskManager } from './taskManager'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('TaskManager', () => {
  it('stores completed task results', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => {
      await sleep(10)
      return { content: 'ok' }
    } })

    const start = manager.get(taskId)
    expect(start?.status).toBe('running')

    const waited = await manager.wait(taskId, { timeoutMs: 1000 })
    expect(waited.timedOut).toBe(false)
    expect(waited.snapshot.status).toBe('completed')
    expect(waited.snapshot.result?.content).toBe('ok')
  })

  it('supports progress updates and keeps metadata fields', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      kind: 'agent',
      label: 'agent-task',
      run: async (ctx) => {
        ctx.updateResult({ content: 'progress' })
        await sleep(2)
        return { content: 'final' }
      },
    })

    const waited = await manager.wait(taskId, { timeoutMs: 1000 })
    expect(waited.timedOut).toBe(false)
    expect(waited.snapshot.kind).toBe('agent')
    expect(waited.snapshot.label).toBe('agent-task')
    expect(waited.snapshot.status).toBe('completed')
    expect(waited.snapshot.result?.content).toBe('final')
  })

  it('returns timedOut=true when still running', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => {
      await sleep(50)
      return { content: 'done' }
    } })

    const waited = await manager.wait(taskId, { timeoutMs: 1 })
    expect(waited.timedOut).toBe(true)
    expect(waited.snapshot.status).toBe('running')

    const waited2 = await manager.wait(taskId, { timeoutMs: 1000 })
    expect(waited2.timedOut).toBe(false)
    expect(waited2.snapshot.status).toBe('completed')
  })

  it('throws when aborted', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => {
      await sleep(50)
      return { content: 'done' }
    } })

    const ac = new AbortController()
    const p = manager.wait(taskId, { timeoutMs: 1000, signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toThrow('Request aborted')
  })

  it('marks task as error when run result has is_error=true', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      run: async () => ({ content: 'bad', is_error: true }),
    })

    const waited = await manager.wait(taskId, { timeoutMs: 1000 })
    expect(waited.snapshot.status).toBe('error')
    expect(waited.snapshot.result?.is_error).toBe(true)
  })

  it('wraps thrown non-Error values', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      run: async () => {
        throw 'boom'
      },
    })

    const waited = await manager.wait(taskId, { timeoutMs: 1000 })
    expect(waited.snapshot.status).toBe('error')
    expect(waited.snapshot.result?.content).toContain('Error: boom')
  })

  it('wraps thrown Error instances', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      run: async () => {
        throw new Error('kaput')
      },
    })

    const waited = await manager.wait(taskId, { timeoutMs: 1000 })
    expect(waited.snapshot.status).toBe('error')
    expect(waited.snapshot.result?.content).toContain('Error: kaput')
  })

  it('cancel returns false for unknown or completed tasks', async () => {
    const manager = new TaskManager()
    expect(manager.cancel('missing')).toBe(false)

    const taskId = manager.create({ run: async () => ({ content: 'ok' }) })
    await manager.wait(taskId, { timeoutMs: 1000 })
    expect(manager.cancel(taskId)).toBe(false)
  })

  it('cancel sets custom message and ignores throwing cancel callbacks', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      run: async (ctx) => {
        ctx.setCancel(() => {
          throw new Error('cancel hook failed')
        })
        await new Promise<never>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        return { content: 'unreachable' }
      },
    })

    expect(manager.cancel(taskId, { message: 'Stop now' })).toBe(true)
    const waited = await manager.wait(taskId, { timeoutMs: 1000 })
    expect(waited.snapshot.status).toBe('error')
    expect(waited.snapshot.result?.content).toBe('Stop now')
    expect(waited.snapshot.result?.is_error).toBe(true)
  })

  it('uses default abort message when cancellation has no custom message', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      run: async (ctx) => {
        await new Promise<never>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        return { content: 'unreachable' }
      },
    })

    expect(manager.cancel(taskId)).toBe(true)
    const waited = await manager.wait(taskId, { timeoutMs: 1000 })
    expect(waited.snapshot.status).toBe('error')
    expect(waited.snapshot.result?.content).toBe('Request aborted')
  })

  it('get returns undefined for missing id and list returns newest first', async () => {
    const manager = new TaskManager()
    expect(manager.get('missing')).toBeUndefined()

    const first = manager.create({ run: async () => ({ content: 'first' }) })
    await manager.wait(first, { timeoutMs: 1000 })
    await sleep(2)
    const second = manager.create({ run: async () => ({ content: 'second' }) })
    await manager.wait(second, { timeoutMs: 1000 })

    const listed = manager.list()
    expect(listed.length).toBe(2)
    expect(listed[0]?.id).toBe(second)
    expect(listed[1]?.id).toBe(first)
  })

  it('wait throws for missing task and returns immediately for completed tasks', async () => {
    const manager = new TaskManager()
    await expect(manager.wait('missing', { timeoutMs: 1 })).rejects.toThrow("Task 'missing' not found")

    const taskId = manager.create({ run: async () => ({ content: 'ok' }) })
    await manager.wait(taskId, { timeoutMs: 1000 })
    const immediate = await manager.wait(taskId, { timeoutMs: 1000 })
    expect(immediate.timedOut).toBe(false)
    expect(immediate.snapshot.status).toBe('completed')
  })

  it('wait handles negative timeout and already-aborted signals', async () => {
    const manager = new TaskManager()

    const normalTask = manager.create({
      run: async () => {
        await sleep(5)
        return { content: 'done' }
      },
    })
    const noTimeout = await manager.wait(normalTask, { timeoutMs: -1 })
    expect(noTimeout.timedOut).toBe(false)
    expect(noTimeout.snapshot.status).toBe('completed')

    const abortTask = manager.create({
      run: async () => {
        await sleep(20)
        return { content: 'late' }
      },
    })
    const ac = new AbortController()
    ac.abort()
    await expect(manager.wait(abortTask, { signal: ac.signal, timeoutMs: 1000 })).rejects.toThrow('Request aborted')
  })

  it('wait uses default timeout when options are omitted', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      run: async () => ({ content: 'ok' }),
    })

    const waited = await manager.wait(taskId)
    expect(waited.timedOut).toBe(false)
    expect(waited.snapshot.status).toBe('completed')
  })
})
