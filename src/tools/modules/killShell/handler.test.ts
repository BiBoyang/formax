import { describe, it, expect } from 'vitest'
import { TaskManager } from '../../runtime/taskManager'
import { createKillShellToolHandler } from './handler'

describe('KillShellToolHandler', () => {
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

    expect(JSON.parse(result.content)).toEqual({ shell_id: taskId, ok: true })

    const waited = await taskManager.wait(taskId, { timeoutMs: 1000 })
    expect(waited.snapshot.status).toBe('error')
    expect(waited.snapshot.result?.content).toContain('Killed')
  })
})

