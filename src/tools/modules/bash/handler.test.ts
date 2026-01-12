import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { TaskManager } from '../../runtime/taskManager'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createBashToolHandler } from './handler'

describe('BashToolHandler', () => {
  const approveUserInput: UserInputManager = {
    requestAnswers: async () => ({ decision: 'approve' }),
    submitAnswers: () => true,
    reject: () => true,
    isPending: () => false,
  }

  const cancelUserInput: UserInputManager = {
    requestAnswers: async () => ({ decision: 'cancel' }),
    submitAnswers: () => true,
    reject: () => true,
    isPending: () => false,
  }

  it('runs commands in the background and stores output', async () => {
    const taskManager = new TaskManager()
    const handler = createBashToolHandler({ taskManager, userInput: approveUserInput })

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
    const taskManager = new TaskManager()
    const handler = createBashToolHandler({ taskManager, userInput: approveUserInput })

    const result = await handler.execute(
      { id: '1', name: 'Bash', input: { command: 'rm -rf /' } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('denied')
  })

  it('requires confirmation for risky commands', async () => {
    const taskManager = new TaskManager()
    const handler = createBashToolHandler({ taskManager, userInput: cancelUserInput })

    const dir = path.join(os.tmpdir(), `formax-bash-confirm-${Date.now()}`)
    const command = `mkdir \"${dir}\"`

    const rejectedEvenWithConfirmFlag = await handler.execute(
      { id: '1', name: 'Bash', input: { command } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(rejectedEvenWithConfirmFlag.is_error).toBe(true)
    expect(rejectedEvenWithConfirmFlag.content).toContain('User rejected')

    await expect(fsp.stat(dir)).rejects.toThrow()

    const approvingHandler = createBashToolHandler({ taskManager, userInput: approveUserInput })
    const allowed = await approvingHandler.execute(
      { id: '2', name: 'Bash', input: { command } } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(allowed.is_error).toBeUndefined()
    await expect(fsp.stat(dir)).resolves.toBeDefined()
  })

  it('plan mode allows read-only commands but blocks others by default', async () => {
    const taskManager = new TaskManager()
    const handler = createBashToolHandler({ taskManager, userInput: cancelUserInput })

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
    expect(blocked.content).toContain('User rejected')
  })

  it('allows confirmation prompts inside a sub-agent', async () => {
    const taskManager = new TaskManager()
    const userInput: UserInputManager = {
      requestAnswers: async () => ({ decision: 'approve' }),
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    }
    const handler = createBashToolHandler({ taskManager, userInput })

    const dir = path.join(os.tmpdir(), `formax-bash-subagent-${Date.now()}`)
    const command = `mkdir \"${dir}\"`
    const result = await handler.execute(
      { id: '1', name: 'Bash', input: { command } } as any,
      { cwd: process.cwd(), agentDepth: 1, replMode: 'plan' },
    )

    expect(result.is_error).toBeUndefined()
    await expect(fsp.stat(dir)).resolves.toBeDefined()
  })
})
