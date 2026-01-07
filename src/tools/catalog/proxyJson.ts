import type { ToolDefinition } from '../types'
import { loadToolDefinitions } from '../loader'

export interface ToolSpecSource {
  listSpecs(): Promise<ToolDefinition[]>
}

export function createProxyJsonSpecSource(opts: {
  filePath: string
}): ToolSpecSource {
  return {
    async listSpecs(): Promise<ToolDefinition[]> {
      return loadToolDefinitions({ filePath: opts.filePath })
    },
  }
}

