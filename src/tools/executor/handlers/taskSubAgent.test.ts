import { describe, it, expect } from 'vitest'
import { createTaskSubAgentToolHandler } from './taskSubAgent'
import type { SubAgentRegistry } from '../../../subagents/registry'
import type { SubAgentRunner } from '../../../subagents/runner'
import type { ToolCall } from '../../types'

describe('TaskSubAgentToolHandler', () => {
  const registry: SubAgentRegistry = {
    async loadFromDirectory() {},
    get() {
      return undefined
    },
    list() {
      return []
    },
  }

  it('returns error when required fields are missing', async () => {
    const runner: SubAgentRunner = {
      async run() {
        return { summary: 'ok', success: true }
      },
    }

    const handler = createTaskSubAgentToolHandler({ registry, runner })
    const call: ToolCall = { id: '1', name: 'Task', input: {} }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Missing required fields')
  })

  it('returns error when sub-agent is not found', async () => {
    const runner: SubAgentRunner = {
      async run() {
        return { summary: 'ok', success: true }
      },
    }

    const handler = createTaskSubAgentToolHandler({ registry, runner })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { subagent_type: 'missing', prompt: 'hi' },
    }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBe(true)
    expect(result.content).toContain("Sub-agent type 'missing' not found")
  })

  it('returns summary on success', async () => {
    const agent = {
      name: 'code-reviewer',
      description: 'Reviews code',
      tools: [],
      systemPrompt: 'Return summary only.',
    }

    const registryOk: SubAgentRegistry = {
      async loadFromDirectory() {},
      get(name: string) {
        return name === 'code-reviewer' ? agent : undefined
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run() {
        return { summary: 'looks good', success: true }
      },
    }

    const handler = createTaskSubAgentToolHandler({ registry: registryOk, runner })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { subagent_type: 'code-reviewer', prompt: 'review' },
    }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBeFalsy()
    expect(result.content).toBe('looks good')
  })

  it('truncates long summaries to 500 characters', async () => {
    const agent = {
      name: 'code-reviewer',
      description: 'Reviews code',
      tools: [],
      systemPrompt: 'Return summary only.',
    }

    const registryOk: SubAgentRegistry = {
      async loadFromDirectory() {},
      get() {
        return agent
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run() {
        return { summary: 'a'.repeat(600), success: true }
      },
    }

    const handler = createTaskSubAgentToolHandler({ registry: registryOk, runner })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { subagent_type: 'code-reviewer', prompt: 'review' },
    }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBeFalsy()
    expect(result.content).toHaveLength(501)
    expect(result.content.endsWith('…')).toBe(true)
  })

  it('returns JSON when artifacts are present', async () => {
    const agent = {
      name: 'code-reviewer',
      description: 'Reviews code',
      tools: [],
      systemPrompt: 'Return summary only.',
    }

    const registryOk: SubAgentRegistry = {
      async loadFromDirectory() {},
      get() {
        return agent
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run() {
        return { summary: 'ok', success: true, artifacts: ['a.txt'] }
      },
    }

    const handler = createTaskSubAgentToolHandler({ registry: registryOk, runner })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { subagent_type: 'code-reviewer', prompt: 'review' },
    }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBeFalsy()
    const parsed = JSON.parse(result.content)
    expect(parsed).toEqual({ summary: 'ok', artifacts: ['a.txt'] })
  })

  it('returns error when runner fails', async () => {
    const agent = {
      name: 'code-reviewer',
      description: 'Reviews code',
      tools: [],
      systemPrompt: 'Return summary only.',
    }

    const registryOk: SubAgentRegistry = {
      async loadFromDirectory() {},
      get() {
        return agent
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run() {
        return { summary: '', success: false, error: 'boom' }
      },
    }

    const handler = createTaskSubAgentToolHandler({ registry: registryOk, runner })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { subagent_type: 'code-reviewer', prompt: 'review' },
    }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBe(true)
    expect(result.content).toBe('Error: boom')
  })
})

