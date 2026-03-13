import { describe, it, expect } from 'vitest'
import { TaskManager } from '../../runtime/taskManager'
import { createKillShellToolHandler } from './handler'

describe('KillShellToolHandler', () => {
  it('reports canHandle only for KillShell', () => {
    const taskManager = new TaskManager()
    const handler = createKillShellToolHandler(taskManager)
    expect(handler.canHandle('KillShell')).toBe(true)
    expect(handler.canHandle('Read')).toBe(false)
  })

  it('returns error when shell_id is missing', async () => {
    const taskManager = new TaskManager()
    const handler = createKillShellToolHandler(taskManager)

    const res = await handler.execute(
      { id: '1', name: 'KillShell', input: {} } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Missing required field shell_id')
  })

  it('returns error when shell task is not found', async () => {
    const taskManager = new TaskManager()
    const handler = createKillShellToolHandler(taskManager)

    const res = await handler.execute(
      { id: '1', name: 'KillShell', input: { shell_id: 'missing' } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain("Shell 'missing' not found")
  })

  it('returns error when task exists but is not a shell', async () => {
    const taskManager = new TaskManager()
    const agentTaskId = taskManager.create({
      kind: 'agent',
      label: 'agent',
      run: async () => ({ content: 'ok' }),
    })

    const handler = createKillShellToolHandler(taskManager)
    const res = await handler.execute(
      { id: '1', name: 'KillShell', input: { shell_id: agentTaskId } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('is not a shell task')
  })

  it('returns error JSON when shell is not running', async () => {
    const taskManager = new TaskManager()
    const taskId = taskManager.create({
      kind: 'shell',
      label: 'completed shell',
      run: async () => ({ content: 'done' }),
    })

    await taskManager.wait(taskId, { timeoutMs: 1000 })

    const handler = createKillShellToolHandler(taskManager)
    const res = await handler.execute(
      { id: '1', name: 'KillShell', input: { shell_id: taskId } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    const parsed = JSON.parse(String(res.content))
    expect(parsed).toEqual({ shell_id: taskId, status: 'completed', ok: false })
  })

  it('returns error when taskManager.cancel returns false', async () => {
    const fakeTaskManager = {
      get() {
        return {
          id: 's1',
          kind: 'shell',
          status: 'running',
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      },
      cancel() {
        return false
      },
    } as any

    const handler = createKillShellToolHandler(fakeTaskManager)
    const res = await handler.execute(
      { id: '1', name: 'KillShell', input: { shell_id: 's1' } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(JSON.parse(String(res.content))).toEqual({ shell_id: 's1', ok: false })
  })

  it('returns a compact strict input error for unexpected fields', async () => {
    const taskManager = new TaskManager()
    const handler = createKillShellToolHandler(taskManager)

    const res = await handler.execute(
      { id: '1', name: 'KillShell', input: { shell_id: 'x', extra: 1 } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('KillShell.input has unknown field: extra')
  })

  it('returns a compact strict input error when input is not an object', async () => {
    const taskManager = new TaskManager()
    const handler = createKillShellToolHandler(taskManager)

    const res = await handler.execute(
      { id: '1', name: 'KillShell', input: [] } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('KillShell.input must be an object')
  })

  it('cancels a running shell task', async () => {
    const taskManager = new TaskManager()
    let cancelCalled = false

    const taskId = taskManager.create({
      kind: 'shell',
      label: 'test shell',
      run: async ({ signal, setCancel }) => {
        setCancel(() => {
          cancelCalled = true
        })

        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })

        return { content: cancelCalled ? 'Killed' : 'Request aborted', is_error: true }
      },
    })

    const handler = createKillShellToolHandler(taskManager)
    const result = await handler.execute(
      { id: '1', name: 'KillShell', input: { shell_id: taskId } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(JSON.parse(String(result.content))).toEqual({ shell_id: taskId, ok: true })

    const waited = await taskManager.wait(taskId, { timeoutMs: 1000 })
    expect(waited.snapshot.status).toBe('error')
    expect(waited.snapshot.result?.content).toContain('Killed')
  })

  it('stringifies non-Error exceptions thrown during execution', async () => {
    const fakeTaskManager = {
      get() {
        throw 'boom'
      },
      cancel() {
        return false
      },
    } as any

    const handler = createKillShellToolHandler(fakeTaskManager)
    const res = await handler.execute(
      { id: '1', name: 'KillShell', input: { shell_id: 's1' } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Error: boom')
  })

  it('treats missing input as an empty object for strict parsing', async () => {
    const taskManager = new TaskManager()
    const handler = createKillShellToolHandler(taskManager)
    const res = await handler.execute(
      { id: '1', name: 'KillShell' } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Missing required field shell_id')
  })
})
