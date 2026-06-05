import { describe, expect, it } from 'vitest'
import { FakeMcpClient } from '../../../mcp/fakeClient'
import { McpServerManager } from '../../../mcp/serverManager'
import { createMcpToolHandler } from './handler'

describe('createMcpToolHandler', () => {
  it('handles model-facing MCP names and dispatches through the manager', async () => {
    const client = new FakeMcpClient([
      { name: 'Create/Issue', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } },
    ], {
      'Create/Issue': { content: [{ type: 'text', text: 'created' }] },
    })
    const manager = new McpServerManager({
      config: { servers: { github: { type: 'stdio', command: 'github-mcp', enabled: true } } },
      clientFactory: async () => client,
    })
    await manager.activate()

    const handler = createMcpToolHandler(manager)
    expect(handler.canHandle('mcp__github__create_issue')).toBe(true)
    expect(handler.canHandle('mcp__github__missing_tool')).toBe(true)
    expect(handler.canHandle('Read')).toBe(false)

    await expect(handler.execute(
      { id: 'toolu_1', name: 'mcp__github__create_issue', input: { title: 'hello' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )).resolves.toEqual({
      tool_use_id: 'toolu_1',
      content: [{ type: 'text', text: 'created' }],
    })
    expect(client.calls).toEqual([
      { name: 'Create/Issue', arguments: { title: 'hello' } },
    ])
  })

  it('rejects malformed non-object MCP tool input before calling the manager', async () => {
    const client = new FakeMcpClient([
      { name: 'Create/Issue', inputSchema: { type: 'object' } },
    ])
    const manager = new McpServerManager({
      config: { servers: { github: { type: 'stdio', command: 'github-mcp', enabled: true } } },
      clientFactory: async () => client,
    })
    await manager.activate()

    const handler = createMcpToolHandler(manager)
    await expect(handler.execute(
      { id: 'toolu_bad', name: 'mcp__github__create_issue', input: null },
      { cwd: process.cwd(), agentDepth: 0 },
    )).resolves.toEqual({
      tool_use_id: 'toolu_bad',
      content: 'Error: MCP tool input for mcp__github__create_issue must be a JSON object',
      is_error: true,
    })
    expect(client.calls).toEqual([])
  })
})
