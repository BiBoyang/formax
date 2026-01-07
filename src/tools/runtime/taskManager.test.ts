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
})
