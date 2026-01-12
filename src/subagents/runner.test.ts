import { describe, it, expect } from 'vitest'
import { createSubAgentRunner } from './runner'
import type { ToolDefinition, ToolCall, ToolResult } from '../tools/types'
import { createToolExecutor } from '../tools/executor'
import type { ToolHandler } from '../tools/executor'
import type { StreamOnceArgs } from '../streaming/anthropic/StreamClient'

function tool(name: string): ToolDefinition {
  return { name, description: `${name} tool`, input_schema: {} }
}

class RecordingClient {
  public calls: Array<{ tools: ToolDefinition[] }> = []
  private responseText: string

  constructor(responseText: string) {
    this.responseText = responseText
  }

  async streamOnce(args: StreamOnceArgs): Promise<{
    contentBlocks: any[]
    stopReason: string | null
    toolResults: ToolResult[]
  }> {
    this.calls.push({ tools: args.tools })
    args.onEvent({ type: 'assistant_delta', text: this.responseText } as any)
    return {
      contentBlocks: [{ type: 'text', text: this.responseText }],
      stopReason: 'end_turn',
      toolResults: [],
    }
  }
}

class ToolUseClient {
  public calls: Array<{ tools: ToolDefinition[] }> = []
  public firstToolResult: ToolResult | null = null
  private callCount = 0

  async streamOnce(args: StreamOnceArgs): Promise<{
    contentBlocks: any[]
    stopReason: string | null
    toolResults: ToolResult[]
  }> {
    this.calls.push({ tools: args.tools })
    this.callCount++

    if (this.callCount === 1) {
      const call: ToolCall = {
        id: 't1',
        name: 'Task',
        input: { subagent_type: 'code-reviewer', prompt: 'nested' },
      }
      const result = await args.executeTool(call)
      this.firstToolResult = result
      return {
        contentBlocks: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }],
        stopReason: 'tool_use',
        toolResults: [result],
      }
    }

    args.onEvent({ type: 'assistant_delta', text: 'done' } as any)
    return {
      contentBlocks: [{ type: 'text', text: 'done' }],
      stopReason: 'end_turn',
      toolResults: [],
    }
  }
}

class WildcardToolUseClient {
  public calls: Array<{ tools: ToolDefinition[] }> = []
  public firstToolResult: ToolResult | null = null
  private callCount = 0

  async streamOnce(args: StreamOnceArgs): Promise<{
    contentBlocks: any[]
    stopReason: string | null
    toolResults: ToolResult[]
  }> {
    this.calls.push({ tools: args.tools })
    this.callCount++

    if (this.callCount === 1) {
      const call: ToolCall = { id: 't1', name: 'Read', input: { file_path: '/tmp/any' } }
      const result = await args.executeTool(call)
      this.firstToolResult = result
      return {
        contentBlocks: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }],
        stopReason: 'tool_use',
        toolResults: [result],
      }
    }

    args.onEvent({ type: 'assistant_delta', text: 'done' } as any)
    return {
      contentBlocks: [{ type: 'text', text: 'done' }],
      stopReason: 'end_turn',
      toolResults: [],
    }
  }
}

class ReplModeFlipClient {
  private callCount = 0

  async streamOnce(args: StreamOnceArgs): Promise<{
    contentBlocks: any[]
    stopReason: string | null
    toolResults: ToolResult[]
  }> {
    this.callCount++

    if (this.callCount === 1) {
      const call: ToolCall = { id: 'w1', name: 'Write', input: { file_path: '/tmp/one', content: 'x' } }
      const result = await args.executeTool(call)
      return {
        contentBlocks: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }],
        stopReason: 'tool_use',
        toolResults: [result],
      }
    }

    if (this.callCount === 2) {
      const call: ToolCall = { id: 'w2', name: 'Write', input: { file_path: '/tmp/two', content: 'y' } }
      const result = await args.executeTool(call)
      return {
        contentBlocks: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }],
        stopReason: 'tool_use',
        toolResults: [result],
      }
    }

    args.onEvent({ type: 'assistant_delta', text: 'done' } as any)
    return {
      contentBlocks: [{ type: 'text', text: 'done' }],
      stopReason: 'end_turn',
      toolResults: [],
    }
  }
}

describe('SubAgentRunner', () => {
  it('filters tools by allowlist and forbids nested tools', async () => {
    const client = new RecordingClient('ok')
    const executor = createToolExecutor([])
    const runner = createSubAgentRunner({
      client: client as any,
      executor,
      allTools: [tool('Read'), tool('Glob'), tool('Task'), tool('Bash'), tool('Dispatch')],
    })

    const result = await runner.run({
      agent: {
        name: 'code-reviewer',
        description: 'Reviews code',
        tools: ['Read', 'Task', 'Glob'],
        systemPrompt: 'Return a summary.',
      },
      task: 'review',
    })

    expect(result.success).toBe(true)
    expect(typeof result.agentId).toBe('string')
    expect(result.summary).toBe('ok')
    expect(client.calls).toHaveLength(1)
    expect(client.calls[0]!.tools.map((t) => t.name).sort()).toEqual(['Glob', 'Read'])
  })

  it('truncates summary to 500 characters', async () => {
    const long = 'a'.repeat(600)
    const client = new RecordingClient(long)
    const executor = createToolExecutor([])
    const runner = createSubAgentRunner({
      client: client as any,
      executor,
      allTools: [tool('Read')],
    })

    const result = await runner.run({
      agent: {
        name: 'any',
        description: 'any',
        tools: ['Read'],
        systemPrompt: 'Return summary only.',
      },
      task: 'x',
    })

    expect(result.success).toBe(true)
    expect(typeof result.agentId).toBe('string')
    expect(result.summary).toHaveLength(501)
    expect(result.summary.endsWith('…')).toBe(true)
  })

  it('denies nested Task execution even if called', async () => {
    const client = new ToolUseClient()
    const executor = createToolExecutor([])
    const runner = createSubAgentRunner({
      client: client as any,
      executor,
      allTools: [tool('Task'), tool('Read')],
    })

    const result = await runner.run({
      agent: {
        name: 'any',
        description: 'any',
        tools: ['Task', 'Read'],
        systemPrompt: 'Return summary only.',
      },
      task: 'x',
    })

    expect(result.success).toBe(true)
    expect(typeof result.agentId).toBe('string')
    expect(result.summary).toBe('done')
    expect(client.calls[0]!.tools.map((t) => t.name).sort()).toEqual(['Read'])
    expect(client.firstToolResult?.is_error).toBe(true)
    expect(client.firstToolResult?.content).toContain('not allowed inside a sub-agent')
  })

  it('supports wildcard allowlist ("*") for subagents', async () => {
    const client = new WildcardToolUseClient()
    const handler: ToolHandler = {
      canHandle(name) {
        return name === 'Read'
      },
      async execute(call) {
        return { tool_use_id: call.id, content: 'ok' }
      },
    }
    const executor = createToolExecutor([handler])
    const runner = createSubAgentRunner({
      client: client as any,
      executor,
      allTools: [tool('Read'), tool('Glob'), tool('Task'), tool('Dispatch')],
    })

    const result = await runner.run({
      agent: {
        name: 'general-purpose',
        description: 'Any task',
        tools: ['*'],
        systemPrompt: 'Return summary only.',
      },
      task: 'x',
    })

    expect(result.success).toBe(true)
    expect(typeof result.agentId).toBe('string')
    expect(result.summary).toBe('done')
    expect(client.calls[0]!.tools.map((t) => t.name).sort()).toEqual(['Glob', 'Read'])
    expect(client.firstToolResult).toEqual({ tool_use_id: 't1', content: 'ok' })
  })

  it('supports acceptEdits mode flips inside subagents', async () => {
    const client = new ReplModeFlipClient()
    const seen: string[] = []
    const handler: ToolHandler = {
      canHandle(name) {
        return name === 'Write'
      },
      async execute(call, ctx) {
        const mode = String(ctx.getReplMode?.() ?? ctx.replMode ?? '')
        seen.push(mode)
        if (call.id === 'w1') ctx.setReplMode?.('acceptEdits')
        return { tool_use_id: call.id, content: mode }
      },
    }
    const executor = createToolExecutor([handler])
    const runner = createSubAgentRunner({
      client: client as any,
      executor,
      allTools: [tool('Write'), tool('Read')],
    })

    const result = await runner.run({
      agent: {
        name: 'any',
        description: 'any',
        tools: ['Write'],
        systemPrompt: 'Return summary only.',
      },
      task: 'x',
      replMode: 'normal',
    })

    expect(result.success).toBe(true)
    expect(result.summary).toBe('done')
    expect(seen).toEqual(['normal', 'acceptEdits'])
  })
})
