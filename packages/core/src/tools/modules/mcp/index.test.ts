import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../../registry'
import { FakeMcpClient } from '../../../mcp/fakeClient'
import { McpServerManager } from '../../../mcp/serverManager'
import { createMcpToolModule, mergeMcpToolDefinitions } from './index'
import { resolveDeferredToolExposureForTurn } from '../../runtime/deferredToolExposureResolver'
import { getDeferredToolExposureStore } from '../../runtime/deferredToolExposure'

async function activatedManager(): Promise<McpServerManager> {
  const client = new FakeMcpClient([
    { name: 'Create/Issue', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } },
  ])
  const manager = new McpServerManager({
    config: { servers: { github: { type: 'stdio', command: 'github-mcp', enabled: true } } },
    clientFactory: async () => client,
  })
  await manager.activate()
  return manager
}

describe('createMcpToolModule', () => {
  it('merges MCP tool definitions into direct exposure like ordinary tools', async () => {
    const registry = new ToolRegistry()
    registry.register({ name: 'Read', spec: { name: 'Read', description: 'Read file', input_schema: { type: 'object' } } })
    registry.register(createMcpToolModule({ manager: await activatedManager() }))

    const specs = await registry.listSpecs()
    expect(specs.map((tool) => tool.name)).toEqual(['Read', 'mcp__github__create_issue'])

    const exposure = resolveDeferredToolExposureForTurn({
      cwd: process.cwd(),
      tools: specs,
      deferredToolExposureEnabled: false,
    })
    expect(exposure.toolsForTurn.map((tool) => tool.name)).toEqual(['Read', 'mcp__github__create_issue'])
  })

  it('routes MCP tool definitions through deferred exposure without MCP-specific fallback', async () => {
    const registry = new ToolRegistry()
    registry.register({ name: 'Read', spec: { name: 'Read', description: 'Read file', input_schema: { type: 'object' } } })
    registry.register(createMcpToolModule({ manager: await activatedManager() }))

    const specs = await registry.listSpecs()
    const sessionKey = `mcp-test-${Date.now()}`
    const exposure = resolveDeferredToolExposureForTurn({
      cwd: process.cwd(),
      tools: specs,
      deferredToolExposureEnabled: true,
      explicitSessionKey: sessionKey,
      includeSkillsReminderBlock: false,
    })

    expect(exposure.toolsForTurn.map((tool) => tool.name)).toEqual(['ToolSearch'])
    expect(exposure.injectedPromptBlocks
      .map((block) => {
        const record = block as any
        return record?.type === 'text' ? String(record.text ?? '') : ''
      })
      .join('\n')).toContain('mcp__github__create_issue')

    const loaded = getDeferredToolExposureStore().searchAndLoad({
      sessionKey,
      query: 'select:mcp__github__create_issue',
    })
    expect(loaded.isError).toBe(false)
    expect(exposure.resolveToolsForCall?.().map((tool) => tool.name)).toContain('mcp__github__create_issue')
  })

  it('keeps deterministic existing tool definitions when MCP names collide', () => {
    const existing = { name: 'mcp__github__create_issue', description: 'existing', input_schema: { type: 'object' } }
    const dynamic = { name: 'mcp__github__create_issue', description: 'dynamic', input_schema: { type: 'object' } }

    expect(mergeMcpToolDefinitions({
      tools: [existing],
      mcpTools: [dynamic],
    })).toEqual([existing])
  })

  it('suppresses colliding MCP manager bindings when existing tools reserve names', async () => {
    const manager = await activatedManager()
    const existing = {
      name: 'mcp__github__create_issue',
      description: 'existing static tool',
      input_schema: { type: 'object' },
    }
    const registry = new ToolRegistry()
    registry.register({ name: existing.name, spec: existing })
    registry.register(createMcpToolModule({ manager }))

    await expect(registry.listSpecs()).resolves.toEqual([existing])
    expect(manager.getCatalog().bindings).toEqual([])
    await expect(manager.callTool({
      toolUseId: 'collision',
      modelName: 'mcp__github__create_issue',
      arguments: {},
    })).resolves.toMatchObject({
      is_error: true,
      content: 'Error: Unknown MCP tool: mcp__github__create_issue',
    })
  })
})
