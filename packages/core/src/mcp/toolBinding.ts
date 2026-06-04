import type { McpToolBinding, McpToolCatalog } from './types.js'

export function createMcpToolBindingIndex(catalog: McpToolCatalog): Map<string, McpToolBinding> {
  return new Map(catalog.bindings.map((binding) => [binding.modelName, binding]))
}

export function resolveMcpToolBinding(
  catalog: McpToolCatalog,
  modelName: string,
): McpToolBinding | undefined {
  return catalog.bindings.find((binding) => binding.modelName === modelName)
}
