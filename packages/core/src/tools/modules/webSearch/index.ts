import type { ToolModule } from '../../registry'
import { WebSearchToolHandler } from './handler'
import { WebSearchToolPresenter } from './presenter'
import { spec } from './spec'

export const webSearchToolModule: ToolModule = {
  name: 'WebSearch',
  handler: WebSearchToolHandler,
  presenter: WebSearchToolPresenter,
  spec,
}
