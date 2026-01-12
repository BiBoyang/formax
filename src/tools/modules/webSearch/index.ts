import type { ToolModule } from '../../registry'
import { WebSearchToolHandler } from './handler'
import { spec } from './spec'

export const webSearchToolModule: ToolModule = {
  name: 'WebSearch',
  handler: WebSearchToolHandler,
  spec,
}
