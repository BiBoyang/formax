import { describe, it, expect } from 'vitest'
import { TaskManager } from '../../runtime/taskManager'
import { createTaskOutputToolHandler } from './handler'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('TaskOutputToolHandler', () => {
  it('matches only TaskOutput tool name', async () => {
    const handler = createTaskOutputToolHandler(new TaskManager())
    expect(handler.canHandle('TaskOutput')).toBe(true)
    expect(handler.canHandle('Task')).toBe(false)
  })

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

  it('includes partial output when running (non-blocking)', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      kind: 'other',
      run: async ({ updateResult }) => {
        updateResult({ content: 'partial' })
        await sleep(50)
        return { content: 'done' }
      },
    })

    const handler = createTaskOutputToolHandler(manager)
    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: taskId, block: false } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('running')
    expect(parsed.output).toBe('partial')
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

  it('includes partial output when timed out waiting', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      kind: 'other',
      run: async ({ updateResult }) => {
        updateResult({ content: 'partial' })
        await sleep(50)
        return { content: 'ok' }
      },
    })

    const handler = createTaskOutputToolHandler(manager)
    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: taskId, block: true, timeout: 1 } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('running')
    expect(parsed.timed_out).toBe(true)
    expect(parsed.output).toBe('partial')
  })

  it('returns error when task is missing', async () => {
    const handler = createTaskOutputToolHandler(new TaskManager())
    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: 'missing' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.task_id).toBe('missing')
    expect(parsed.output).toContain("Task 'missing' not found")
  })

  it('propagates task error status and is_error flag', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => ({ content: 'bad', is_error: true }) })
    await sleep(1)

    const handler = createTaskOutputToolHandler(manager)
    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: taskId, block: false } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.output).toBe('bad')
  })

  it('returns JSON error when task_id is missing', async () => {
    const handler = createTaskOutputToolHandler(new TaskManager())
    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: '' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.output).toContain('Missing required field task_id')
  })

  it('returns JSON error when input is omitted', async () => {
    const handler = createTaskOutputToolHandler(new TaskManager())
    const res = await handler.execute({ id: 'missing-input', name: 'TaskOutput' } as any, {
      cwd: process.cwd(),
      agentDepth: 0,
    })

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.output).toContain('Missing required field task_id')
  })

  it('returns JSON error when input is non-object', async () => {
    const handler = createTaskOutputToolHandler(new TaskManager())
    const res = await handler.execute(
      { id: 'non-object-input', name: 'TaskOutput', input: [] as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.output).toContain('TaskOutput.input must be an object')
  })

  it('returns JSON error when task_id is not a string', async () => {
    const handler = createTaskOutputToolHandler(new TaskManager())
    const res = await handler.execute(
      { id: 'non-string-task-id', name: 'TaskOutput', input: { task_id: 123 } as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.output).toContain('Missing required field task_id')
  })

  it('returns JSON error when timeout is invalid', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => ({ content: 'ok' }) })
    const handler = createTaskOutputToolHandler(manager)

    // timeout must be a number
    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: taskId, timeout: 'nope' } as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.task_id).toBe(taskId)
    expect(parsed.output).toContain('timeout must be a number')
  })

  it('returns JSON error when timeout is negative', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => ({ content: 'ok' }) })
    const handler = createTaskOutputToolHandler(manager)

    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: taskId, timeout: -1 } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.task_id).toBe(taskId)
    expect(parsed.output).toContain('timeout must be >= 0')
  })

  it('returns JSON error when timeout exceeds MAX_TIMEOUT_MS', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => ({ content: 'ok' }) })
    const handler = createTaskOutputToolHandler(manager)

    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: taskId, timeout: 600001 } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.task_id).toBe(taskId)
    expect(parsed.output).toContain('timeout must be <=')
  })

  it('returns JSON error when input contains unexpected keys', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({ kind: 'other', run: async () => ({ content: 'ok' }) })
    const handler = createTaskOutputToolHandler(manager)

    const res = await handler.execute(
      { id: '1', name: 'TaskOutput', input: { task_id: taskId, extra: true } as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.task_id).toBe(taskId)
    expect(parsed.output).toContain('Error:')
  })

  it('returns fallback output and is_error when waited task completes with error and empty content', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      kind: 'other',
      run: async () => {
        await sleep(10)
        return { is_error: true } as any
      },
    })
    const handler = createTaskOutputToolHandler(manager)

    const res = await handler.execute(
      { id: 'wait-error-empty', name: 'TaskOutput', input: { task_id: taskId, block: true, timeout: 200 } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.output).toBe('(no output)')
  })

  it('returns fallback output and is_error for completed snapshot with empty content', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      kind: 'other',
      run: async () => ({ is_error: true } as any),
    })
    await sleep(1)

    const handler = createTaskOutputToolHandler(manager)
    const res = await handler.execute(
      { id: 'snapshot-error-empty', name: 'TaskOutput', input: { task_id: taskId, block: false } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.output).toBe('(no output)')
  })

  it('returns completed snapshot without is_error for successful task', async () => {
    const manager = new TaskManager()
    const taskId = manager.create({
      kind: 'other',
      run: async () => ({ content: 'done' }),
    })
    await sleep(1)

    const handler = createTaskOutputToolHandler(manager)
    const res = await handler.execute(
      { id: 'snapshot-success', name: 'TaskOutput', input: { task_id: taskId, block: false } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBeUndefined()
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('completed')
    expect(parsed.output).toBe('done')
  })

  it('converts non-Error throwables into JSON error output', async () => {
    const handler = createTaskOutputToolHandler(new TaskManager())
    const input: any = { task_id: 'x' }
    Object.defineProperty(input, 'timeout', {
      get() {
        throw 'boom'
      },
    })
    const call = { id: 'task-non-error', name: 'TaskOutput', input } as any

    const res = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(res.content)
    expect(parsed.status).toBe('error')
    expect(parsed.output).toContain('Error: boom')
  })
})
