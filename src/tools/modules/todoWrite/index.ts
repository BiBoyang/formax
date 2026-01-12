import type { ToolModule } from '../../registry'
import { TodoWriteToolHandler } from './handler'
import { TodoWriteToolPresenter } from './presenter'
import { spec } from './spec'

export const todoWriteToolModule: ToolModule = {
  name: 'TodoWrite',
  handler: TodoWriteToolHandler,
  presenter: TodoWriteToolPresenter,
  spec,
}
