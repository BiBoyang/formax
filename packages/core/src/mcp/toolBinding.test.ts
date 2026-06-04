import { describe, expect, it } from 'vitest'
import { createMcpToolBindingIndex, resolveMcpToolBinding } from './toolBinding.js'
import { createMcpToolCatalog } from './toolCatalog.js'

describe('MCP tool binding helpers', () => {
  it('indexes and resolves model-facing MCP tool names', () => {
    const catalog = createMcpToolCatalog([
      {
        serverId: 'GitHub Enterprise',
        tools: [{
          name: 'Create/Issue',
          inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
        }],
      },
    ])

    const index = createMcpToolBindingIndex(catalog)
    const binding = index.get('mcp__github_enterprise__create_issue')

    expect(binding).toMatchObject({
      modelName: 'mcp__github_enterprise__create_issue',
      serverId: 'github_enterprise',
      originalServerId: 'GitHub Enterprise',
      toolName: 'create_issue',
      originalToolName: 'Create/Issue',
    })
    expect(resolveMcpToolBinding(catalog, 'mcp__github_enterprise__create_issue')).toBe(binding)
  })
})
