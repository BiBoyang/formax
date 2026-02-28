import { describe, it, expect } from 'vitest'
import { TaskManager } from '../../runtime/taskManager'
import { createBashToolHandler } from './handler'

describe('BashToolHandler', () => {
  function create(): { taskManager: TaskManager; handler: ReturnType<typeof createBashToolHandler> } {
    const taskManager = new TaskManager()
    const handler = createBashToolHandler({ taskManager })
    return { taskManager, handler }
  }

  function nodeCommand(js: string): string {
    return `"${process.execPath}" -e ${JSON.stringify(js)}`
  }

  it('matches only Bash tool name', () => {
    const { handler } = create()
    expect(handler.canHandle('Bash')).toBe(true)
    expect(handler.canHandle('Read')).toBe(false)
  })

  it('runs commands in the background and stores output', async () => {
    const { taskManager, handler } = create()

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

  it('denies destructive commands', async () => {
    const { handler } = create()

    const result = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'rm -rf /' } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('denied')
  })

  it('validates input shape, command, and timeout', async () => {
    const { handler } = create()

    const missingCommand = await handler.execute(
      { id: '1', name: 'Bash', input: {} } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(missingCommand.is_error).toBe(true)
    expect(missingCommand.content).toBe('Error: Missing command')

    const extraKey = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'echo hi', extra: 1 } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(extraKey.is_error).toBe(true)
    expect(extraKey.content).toContain('unknown field')

    const badTimeout = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'echo hi', timeout: 'x' } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(badTimeout.is_error).toBe(true)
    expect(badTimeout.content).toBe('Error: timeout must be a number')

    const negativeTimeout = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'echo hi', timeout: -1 } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(negativeTimeout.is_error).toBe(true)
    expect(negativeTimeout.content).toBe('Error: timeout must be >= 0')

    const tooLargeTimeout = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'echo hi', timeout: 1200001 } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(tooLargeTimeout.is_error).toBe(true)
    expect(tooLargeTimeout.content).toContain('timeout must be <=')
  })

  it('runs in the foreground and formats stdout/stderr/no output and exit codes', async () => {
    const { handler } = create()

    const both = await handler.execute(
      {
        id: '1',
        name: 'Bash',
        input: {
          command: nodeCommand("process.stdout.write('out'); process.stderr.write('err')"),
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(both.is_error).not.toBe(true)
    expect(both.content).toContain('stderr:')
    expect(both.content).toContain('stdout:')
    expect(both.content).toContain('err')
    expect(both.content).toContain('out')

    const controlChars = await handler.execute(
      {
        id: '1',
        name: 'Bash',
        input: {
          command: nodeCommand("process.stdout.write('\\u001b[2Jhello\\rworld'); process.stderr.write('\\u001b[2Jerr\\rline')"),
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(controlChars.is_error).not.toBe(true)
    expect(controlChars.content).not.toContain('\u001b[')
    expect(controlChars.content).not.toContain('\r')
    expect(controlChars.content).toContain('hello')
    expect(controlChars.content).toContain('world')
    expect(controlChars.content).toContain('err')
    expect(controlChars.content).toContain('line')

    const noOutput = await handler.execute(
      { id: '1', name: 'Bash', input: { command: nodeCommand('') } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(noOutput.is_error).not.toBe(true)
    expect(noOutput.content).toBe('(no output)')

    const exitCode = await handler.execute(
      { id: '1', name: 'Bash', input: { command: nodeCommand('process.exit(2)') } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(exitCode.is_error).toBe(true)
    expect(exitCode.content).toContain('Error: Exit code 2')
    expect(exitCode.content).toContain('(no output)')

    const longOutput = await handler.execute(
      {
        id: '1',
        name: 'Bash',
        input: { command: nodeCommand("process.stdout.write('a'.repeat(40000))") },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(longOutput.is_error).not.toBe(true)
    expect(longOutput.content.length).toBeLessThanOrEqual(30000)
  })

  it('still executes when dangerouslyDisableSandbox is requested', async () => {
    const { handler } = create()

    const res = await handler.execute(
      {
        id: '1',
        name: 'Bash',
        input: { command: nodeCommand("console.log('hi')"), dangerouslyDisableSandbox: true },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(res.is_error).not.toBe(true)
    expect(res.content).toContain('hi')
  })

  it('background tasks handle exit code, timeout, and cancel', async () => {
    const { taskManager, handler } = create()

    const exitResult = await handler.execute(
      { id: '1', name: 'Bash', input: { command: nodeCommand('process.exit(7)'), run_in_background: true } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    const exitTaskId = JSON.parse(exitResult.content).task_id as string
    const exitWaited = await taskManager.wait(exitTaskId, { timeoutMs: 5000 })
    expect(exitWaited.snapshot.status).toBe('error')
    expect(exitWaited.snapshot.result?.content).toContain('Exit code 7')

    const timeoutMs = 50
    const timedOutResult = await handler.execute(
      {
        id: '1',
        name: 'Bash',
        input: { command: nodeCommand(`setTimeout(()=>{}, 10000)`), run_in_background: true, timeout: timeoutMs },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    const timedOutTaskId = JSON.parse(timedOutResult.content).task_id as string
    const timedOutWaited = await taskManager.wait(timedOutTaskId, { timeoutMs: 5000 })
    expect(timedOutWaited.snapshot.status).toBe('error')
    expect(timedOutWaited.snapshot.result?.content).toContain(`Timed out after ${timeoutMs}ms`)

    const cancelResult = await handler.execute(
      { id: '1', name: 'Bash', input: { command: nodeCommand(`setTimeout(()=>{}, 10000)`), run_in_background: true } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    const cancelTaskId = JSON.parse(cancelResult.content).task_id as string
    taskManager.cancel(cancelTaskId)
    const cancelWaited = await taskManager.wait(cancelTaskId, { timeoutMs: 5000 })
    expect(cancelWaited.snapshot.status).toBe('error')
    expect(cancelWaited.snapshot.result?.content).toContain('Killed')

    const exitSignalResult = await handler.execute(
      {
        id: '1',
        name: 'Bash',
        input: { command: nodeCommand("process.kill(process.pid, 'SIGTERM')"), run_in_background: true },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    const exitSignalTaskId = JSON.parse(exitSignalResult.content).task_id as string
    const exitSignalWaited = await taskManager.wait(exitSignalTaskId, { timeoutMs: 5000 })
    expect(exitSignalWaited.snapshot.status).toBe('error')
    expect(exitSignalWaited.snapshot.result?.content).toContain('Exit signal SIGTERM')

    const throttledUpdateResult = await handler.execute(
      {
        id: '1',
        name: 'Bash',
        input: {
          command: nodeCommand("process.stdout.write('tick'); setTimeout(()=>process.exit(0), 220)"),
          run_in_background: true,
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    const throttledTaskId = JSON.parse(throttledUpdateResult.content).task_id as string
    const throttledWaited = await taskManager.wait(throttledTaskId, { timeoutMs: 5000 })
    expect(throttledWaited.snapshot.status).toBe('completed')
    expect(throttledWaited.snapshot.result?.content).toContain('tick')
  })
})
