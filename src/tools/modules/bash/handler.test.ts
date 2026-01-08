import { describe, it, expect } from 'vitest'
import { TaskManager } from '../../runtime/taskManager'
import { createBashToolHandler } from './handler'

describe('BashToolHandler', () => {
  it('runs commands in the background and stores output', async () => {
    const taskManager = new TaskManager()
    const handler = createBashToolHandler({ taskManager })

    const command = `"${process.execPath}" -e "console.log('hi')"`

    const result = await handler.execute(
      { id: '1', name: 'Bash', input: { command, run_in_background: true, confirm: true } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const parsed = JSON.parse(result.content)
    expect(parsed.status).toBe('running')
    expect(typeof parsed.task_id).toBe('string')

    const waited = await taskManager.wait(parsed.task_id, { timeoutMs: 5000 })
    expect(waited.snapshot.status).toBe('completed')
    expect(waited.snapshot.result?.content).toContain('hi')
  })

  it('denies destructive commands', async () => {
    const taskManager = new TaskManager()
    const handler = createBashToolHandler({ taskManager })

    const result = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'rm -rf /', confirm: true } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('denied')
  })

  it('requires confirmation for risky commands', async () => {
    const taskManager = new TaskManager()
    const handler = createBashToolHandler({ taskManager })

    const command = `"${process.execPath}" -e "console.log('ok')"`

    const denied = await handler.execute(
      { id: '1', name: 'Bash', input: { command } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(denied.is_error).toBe(true)
    expect(denied.content).toContain('requires confirmation')

    const allowed = await handler.execute(
      { id: '2', name: 'Bash', input: { command, confirm: true } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(allowed.is_error).toBeUndefined()
    expect(allowed.content).toContain('ok')
  })

  it('plan mode allows read-only commands but blocks others by default', async () => {
    const taskManager = new TaskManager()
    const handler = createBashToolHandler({ taskManager })

    const ok = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'echo hi' } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan' },
    )
    expect(ok.is_error).toBeUndefined()
    expect(ok.content).toContain('hi')

    const blocked = await handler.execute(
      { id: '2', name: 'Bash', input: { command: 'mkdir should-not-run' } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan' },
    )
    expect(blocked.is_error).toBe(true)
    expect(blocked.content).toContain('requires confirmation')
  })
})
