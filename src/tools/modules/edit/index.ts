import type { ToolModule } from '../../registry'
import { EditToolHandler } from './handler'
import { EditToolPresenter } from './presenter'

export const editToolModule: ToolModule = {
  name: 'Edit',
  handler: EditToolHandler,
  presenter: EditToolPresenter,
}
