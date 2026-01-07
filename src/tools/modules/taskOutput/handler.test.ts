import { describe, it, expect } from 'vitest'
import { TaskManager } from '../../runtime/taskManager'
import { createTaskOutputToolHandler } from './handler'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('TaskOutputToolHandler', () => {
  it('returns running when non-blocking', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => {
      await sleep(50)
      return { content: 'done' }
    } })

    const handler = createTaskOutputToolHandler(manager)
    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: taskId, block: false } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('running')
  })

  it('blocks until completion when requested', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => {
      await sleep(10)
      return { content: 'ok' }
    } })

    const handler = createTaskOutputToolHandler(manager)
    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: taskId, block: true, timeout: 1000 } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('completed')
    expect(parsed.output).toBe('ok')
  })

  it('returns timed_out when still running after timeout', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => {
      await sleep(50)
      return { content: 'ok' }
    } })

    const handler = createTaskOutputToolHandler(manager)
    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: taskId, block: true, timeout: 1 } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('running')
    expect(parsed.timed_out).toBe(true)
  })

  it('returns error when task is missing', async () => {
    const handler = createTaskOutputToolHandler(new TaskManager())
    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: 'missing' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(res.is_error).toBe(true)
    expect(res.content).toContain("Task 'missing' not found")
  })
})
