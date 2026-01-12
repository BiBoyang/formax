import type { ToolModule } from '../../registry'
import { ReadToolHandler } from './handler'
import { ReadToolPresenter } from './presenter'
import { spec } from './spec'

export const readToolModule: ToolModule = {
  name: 'Read',
  handler: ReadToolHandler,
  presenter: ReadToolPresenter,
  spec,
}
