import { describe, expect, it, vi } from 'vitest'
import type { SubAgentRegistry } from '../../../subagents/registry'
import type { SubAgentRunner } from '../../../subagents/runner'
import type { ToolCall } from '../../types'
import { TaskManager } from '../../runtime/taskManager'

vi.mock('../../../env/config.js', () => ({
  loadRuntimeConfig: async () => ({
    llm: {
      provider: 'anthropic',
      defaultTier: 'invalid-tier',
      configuredModel: undefined,
      tierModels: {},
      contextWindowTokens: undefined,
    },
    context: {
      effectiveContextWindowPercent: 1,
      autoCompactTokenLimitPercent: 0.5,
      baselineTokens: 0,
    },
  }),
}))

vi.mock('../../../config/modelTier.js', () => ({
  parseModelTier: (raw: unknown) => {
    const v = String(raw || '').toLowerCase()
    return v === 'sonnet' || v === 'opus' || v === 'haiku' ? v : null
  },
  resolveModelForTier: ({ tier }: { tier: string }) => `resolved-${tier}`,
}))

import { createTaskSubAgentToolHandler } from './taskSubAgent'

describe('taskSubAgent model fallback', () => {
  it('falls back to sonnet tier when config/agent model tiers are unavailable', async () => {
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

    const seenModels: string[] = []
    const runner: SubAgentRunner = {
      async run(args) {
        seenModels.push(String(args.model))
        return { agentId: 'agent-1', response: 'ok', summary: 'ok', success: true }
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
    expect(seenModels).toEqual(['resolved-sonnet'])
  })
})
