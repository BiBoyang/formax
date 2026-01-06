import { describe, it, expect } from 'vitest'
import { createSubAgentRunner } from './runner'
import type { ToolDefinition, ToolCall, ToolResult } from '../tools/types'
import { createToolExecutor } from '../tools/executor'
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

    expect(result).toEqual({ success: true, summary: 'ok' })
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

    expect(result).toEqual({ success: true, summary: 'done' })
    expect(client.calls[0]!.tools.map((t) => t.name).sort()).toEqual(['Read'])
    expect(client.firstToolResult?.is_error).toBe(true)
    expect(client.firstToolResult?.content).toContain('not allowed inside a sub-agent')
  })
})

