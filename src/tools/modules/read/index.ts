import type { ToolModule } from '../../registry'
import { ReadToolHandler } from './handler'
import { ReadToolPresenter } from './presenter'

export const readToolModule: ToolModule = {
  name: 'Read',
  handler: ReadToolHandler,
  presenter: ReadToolPresenter,
}
