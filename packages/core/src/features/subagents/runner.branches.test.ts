import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolExecutor } from '../../tools/executor'
import type { ToolDefinition } from '../../tools/types'

const mocks = vi.hoisted(() => ({
  runTurn: vi.fn(),
}))

vi.mock('../../chat/engine', () => ({
  createChatEngine: () => ({
    runTurn: mocks.runTurn,
  }),
}))

import { createSubAgentRunner } from './runner'

const TEST_CWD = process.cwd()

describe('SubAgentRunner branch coverage', () => {
  beforeEach(() => {
    mocks.runTurn.mockReset()
  })

  it('stringifies non-Error failures from engine.runTurn', async () => {
    mocks.runTurn.mockRejectedValueOnce('string-failure')

    const runner = createSubAgentRunner({
      client: {} as any,
      executor: {} as ToolExecutor,
      allTools: [] as ToolDefinition[],
    })

    const out = await runner.run({
      cwd: TEST_CWD,
      agent: {
        name: 'agent-a',
        description: 'agent-a',
        tools: [],
        systemPrompt: 'x',
      },
      task: 'task',
    })

    expect(out.success).toBe(false)
    expect(out.error).toBe('string-failure')
  })

  it('fails closed when run cwd is missing at runtime', async () => {
    const runner = createSubAgentRunner({
      client: {} as any,
      executor: {} as ToolExecutor,
      allTools: [] as ToolDefinition[],
    })

    const out = await runner.run({
      cwd: '' as any,
      agent: {
        name: 'agent-a',
        description: 'agent-a',
        tools: [],
        systemPrompt: 'x',
      },
      task: 'task',
    })

    expect(out.success).toBe(false)
    expect(out.error).toBe('SubAgentRunner.run requires cwd')
    expect(mocks.runTurn).not.toHaveBeenCalled()
  })
})
