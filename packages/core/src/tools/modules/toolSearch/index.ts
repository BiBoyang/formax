import type { ToolModule } from '../../registry'
import { createToolSearchToolHandler } from './handler'

export function createToolSearchToolModule(): ToolModule {
  return {
    name: 'ToolSearch',
    handler: createToolSearchToolHandler(),
  }
}
