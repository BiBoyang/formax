import type { McpServerManager } from '../../../mcp/serverManager'
import { isMcpModelToolName } from '../../../mcp/names'
import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import { createMcpToolHandler } from './handler'
import { McpToolPresenter } from './presenter'

export function mergeMcpToolDefinitions(args: {
  tools: ToolDefinition[]
  mcpTools: ToolDefinition[]
}): ToolDefinition[] {
  const seen = new Set(args.tools.map((tool) => tool.name))
  const out = [...args.tools]

  for (const tool of args.mcpTools) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    out.push(tool)
  }

  return out
}

export function createMcpToolModule(deps: { manager: McpServerManager }): ToolModule {
  return {
    name: 'mcp',
    handler: createMcpToolHandler(deps.manager),
    presenter: McpToolPresenter,
    canPresent: isMcpModelToolName,
    patch: (tools) => {
      const mcpTools = deps.manager.getCatalog().bindings.map((binding) => binding.definition)
      const reserved = new Set(tools.map((tool) => tool.name))
      deps.manager.suppressToolBindings(mcpTools
        .filter((tool) => reserved.has(tool.name))
        .map((tool) => tool.name))
      return mergeMcpToolDefinitions({ tools, mcpTools })
    },
  }
}
