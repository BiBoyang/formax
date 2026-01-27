import { describe, it, expect } from 'vitest'
import { createTaskSubAgentToolHandler } from './taskSubAgent'
import type { SubAgentRegistry } from '../../../subagents/registry'
import type { SubAgentRunner } from '../../../subagents/runner'
import type { ToolCall } from '../../types'
import { TaskManager } from '../../runtime/taskManager'

describe('TaskSubAgentToolHandler', () => {
  const registry: SubAgentRegistry = {
    async loadFromDirectory() {},
    async loadFromDirectories() {},
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
        return { agentId: 'a', response: 'ok', summary: 'ok', success: true }
      },
    }

    const handler = createTaskSubAgentToolHandler({ registry, runner, taskManager: new TaskManager() })
    const call: ToolCall = { id: '1', name: 'Task', input: {} }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Missing required fields')
  })

  it('returns error when sub-agent is not found', async () => {
    const runner: SubAgentRunner = {
      async run() {
        return { agentId: 'a', response: 'ok', summary: 'ok', success: true }
      },
    }

    const handler = createTaskSubAgentToolHandler({ registry, runner, taskManager: new TaskManager() })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { description: 'Missing agent', subagent_type: 'missing', prompt: 'hi' },
    }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBe(true)
    expect(result.content).toContain("Agent type 'missing' not found")
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
      async loadFromDirectories() {},
      get(name: string) {
        return name === 'code-reviewer' ? agent : undefined
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run() {
        return { agentId: 'agent-1', response: 'looks good', summary: 'looks good', success: true }
      },
    }

    const handler = createTaskSubAgentToolHandler({
      registry: registryOk,
      runner,
      taskManager: new TaskManager(),
    })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { description: 'Code review', subagent_type: 'code-reviewer', prompt: 'review' },
    }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBeFalsy()
    const parsed = JSON.parse(result.content)
    expect(parsed.status).toBe('completed')
    expect(parsed.summary).toBe('looks good')
    expect(parsed.response).toBe('looks good')
    expect(Array.isArray(parsed.transcript)).toBe(true)
    expect(parsed.transcript.join('\n')).toContain('Prompt:')
    expect(parsed.transcript.join('\n')).toContain('Response:')
    expect(parsed.transcript.join('\n')).toContain('Done (')
    expect(parsed.agent_id).toBe('agent-1')
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
      async loadFromDirectories() {},
      get() {
        return agent
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run() {
        return { agentId: 'agent-1', response: 'a'.repeat(600), summary: 'a'.repeat(600), success: true }
      },
    }

    const handler = createTaskSubAgentToolHandler({
      registry: registryOk,
      runner,
      taskManager: new TaskManager(),
    })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { description: 'Code review', subagent_type: 'code-reviewer', prompt: 'review' },
    }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBeFalsy()
    const parsed = JSON.parse(result.content)
    expect(parsed.summary).toHaveLength(501)
    expect(parsed.summary.endsWith('…')).toBe(true)
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
      async loadFromDirectories() {},
      get() {
        return agent
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run() {
        return { agentId: 'agent-1', response: 'ok', summary: 'ok', success: true, artifacts: ['a.txt'] }
      },
    }

    const handler = createTaskSubAgentToolHandler({
      registry: registryOk,
      runner,
      taskManager: new TaskManager(),
    })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { description: 'Review', subagent_type: 'code-reviewer', prompt: 'review' },
    }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBeFalsy()
    const parsed = JSON.parse(result.content)
    expect(parsed.status).toBe('completed')
    expect(parsed.summary).toBe('ok')
    expect(parsed.artifacts).toEqual(['a.txt'])
    expect(parsed.agent_id).toBe('agent-1')
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
      async loadFromDirectories() {},
      get() {
        return agent
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run() {
        return { agentId: 'agent-1', response: '', summary: '', success: false, error: 'boom' }
      },
    }

    const handler = createTaskSubAgentToolHandler({
      registry: registryOk,
      runner,
      taskManager: new TaskManager(),
    })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { description: 'Review', subagent_type: 'code-reviewer', prompt: 'review' },
    }
    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBe(true)
    const parsed = JSON.parse(result.content)
    expect(parsed.status).toBe('error')
    expect(parsed.error).toBe('boom')
    expect(parsed.agent_id).toBe('agent-1')
  })

  it('validates model when provided', async () => {
    const agent = {
      name: 'code-reviewer',
      description: 'Reviews code',
      tools: [],
      systemPrompt: 'Return summary only.',
    }

    const registryOk: SubAgentRegistry = {
      async loadFromDirectory() {},
      async loadFromDirectories() {},
      get() {
        return agent
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run() {
        return { agentId: 'agent-1', response: 'ok', summary: 'ok', success: true }
      },
    }

    const handler = createTaskSubAgentToolHandler({
      registry: registryOk,
      runner,
      taskManager: new TaskManager(),
    })

    const badEmpty: ToolCall = {
      id: '1',
      name: 'Task',
      input: { description: 'Review', subagent_type: 'code-reviewer', prompt: 'review', model: '   ' },
    }
    const resEmpty = await handler.execute(badEmpty, { cwd: process.cwd(), agentDepth: 0 })
    expect(resEmpty.is_error).toBe(true)
    expect(resEmpty.content).toContain('model must be one of')

    const badUnsupported: ToolCall = {
      id: '2',
      name: 'Task',
      input: { description: 'Review', subagent_type: 'code-reviewer', prompt: 'review', model: 'gpt-4o' },
    }
    const resUnsupported = await handler.execute(badUnsupported, { cwd: process.cwd(), agentDepth: 0 })
    expect(resUnsupported.is_error).toBe(true)
    expect(resUnsupported.content).toContain('Unsupported model')
  })

  it('uses resume agent_id when run_in_background is true', async () => {
    const agent = {
      name: 'code-reviewer',
      description: 'Reviews code',
      tools: [],
      systemPrompt: 'Return summary only.',
    }

    const registryOk: SubAgentRegistry = {
      async loadFromDirectory() {},
      async loadFromDirectories() {},
      get() {
        return agent
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const agentIds: Array<string | undefined> = []
    const runner: SubAgentRunner = {
      async run(args) {
        agentIds.push(args.agentId)
        return { agentId: 'agent-1', response: 'ok', summary: 'ok', success: true }
      },
    }

    const taskManager = new TaskManager()
    const handler = createTaskSubAgentToolHandler({ registry: registryOk, runner, taskManager })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: {
        description: 'Review',
        subagent_type: 'code-reviewer',
        prompt: 'review',
        run_in_background: true,
        resume: 'resume-agent-123',
      },
    }

    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    const parsed = JSON.parse(result.content)
    expect(parsed.status).toBe('running')
    expect(parsed.agent_id).toBe('resume-agent-123')
    expect(typeof parsed.task_id).toBe('string')
    expect(agentIds).toEqual([undefined])
  })

  it('emits nested tool updates to ctx.onEvent', async () => {
    const agent = {
      name: 'code-reviewer',
      description: 'Reviews code',
      tools: [],
      systemPrompt: 'Return summary only.',
    }

    const registryOk: SubAgentRegistry = {
      async loadFromDirectory() {},
      async loadFromDirectories() {},
      get() {
        return agent
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run(args) {
        args.onEvent?.({ type: 'usage', usage: { input_tokens: 1, output_tokens: 2 } })
        args.onEvent?.({ type: 'tool_start', id: 't1', name: 'Bash' })
        args.onEvent?.({ type: 'tool_input', id: 't1', input: { command: 'echo hi' } })
        args.onEvent?.({ type: 'tool_update', id: 't1', middleLines: ['waiting…'] })
        args.onEvent?.({ type: 'tool_end', id: 't1', result: { tool_use_id: 't1', content: 'hi' } })
        return { agentId: 'agent-1', response: 'ok', summary: 'ok', success: true }
      },
    }

    const events: any[] = []
    const handler = createTaskSubAgentToolHandler({
      registry: registryOk,
      runner,
      taskManager: new TaskManager(),
    })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { description: 'Review', subagent_type: 'code-reviewer', prompt: 'review' },
    }

    const result = await handler.execute(call, {
      cwd: process.cwd(),
      agentDepth: 0,
      replMode: 'acceptEdits',
      onEvent: (ev) => events.push(ev),
    })

    expect(result.is_error).toBeFalsy()
    expect(events.some((e) => e.type === 'tool_update' && e.id === '1')).toBe(true)
    const last = events.filter((e) => e.type === 'tool_update' && e.id === '1').slice(-1)[0]
    expect(last.toolUses).toBeGreaterThan(0)
    expect(Array.isArray(last.nestedTools)).toBe(true)
    expect(last.nestedTools.some((t: any) => t.name === 'Bash')).toBe(true)
  })

  it('supports run_in_background and stores result', async () => {
    const agent = {
      name: 'code-reviewer',
      description: 'Reviews code',
      tools: [],
      systemPrompt: 'Return summary only.',
    }

    const registryOk: SubAgentRegistry = {
      async loadFromDirectory() {},
      async loadFromDirectories() {},
      get() {
        return agent
      },
      list() {
        return [{ name: agent.name, description: agent.description }]
      },
    }

    const runner: SubAgentRunner = {
      async run(args) {
        await new Promise((r) => setTimeout(r, 10))
        return {
          agentId: typeof args.agentId === 'string' ? args.agentId : 'agent-1',
          response: 'background',
          summary: 'background',
          success: true,
        }
      },
    }

    const taskManager = new TaskManager()
    const handler = createTaskSubAgentToolHandler({ registry: registryOk, runner, taskManager })
    const call: ToolCall = {
      id: '1',
      name: 'Task',
      input: { description: 'Review', subagent_type: 'code-reviewer', prompt: 'review', run_in_background: true },
    }

    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    const parsed = JSON.parse(result.content)
    expect(parsed.status).toBe('running')
    expect(typeof parsed.task_id).toBe('string')
    expect(parsed.agent_id).toBe(parsed.task_id)

    const waited = await taskManager.wait(parsed.task_id, { timeoutMs: 1000 })
    expect(waited.snapshot.status).toBe('completed')
    expect(waited.snapshot.result?.content).toBe('background')
  })
})
