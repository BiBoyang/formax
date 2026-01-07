import { describe, it, expect } from 'vitest'
import { TaskManager } from '../../runtime/taskManager'
import { createBashToolHandler } from './handler'

describe('BashToolHandler', () => {
  it('runs commands in the background and stores output', async () => {
    const taskManager = new TaskManager()
    const handler = createBashToolHandler({ taskManager })

    const command = `"${process.execPath}" -e "console.log('hi')"`

    const result = await handler.execute(
      { id: '1', name: 'Bash', input: { command, run_in_background: true } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const parsed = JSON.parse(result.content)
    expect(parsed.status).toBe('running')
    expect(typeof parsed.task_id).toBe('string')

    const waited = await taskManager.wait(parsed.task_id, { timeoutMs: 5000 })
    expect(waited.snapshot.status).toBe('completed')
    expect(waited.snapshot.result?.content).toContain('hi')
  })
})

