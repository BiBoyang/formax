import type { ToolModule } from '../../registry'
import { createEditToolHandler } from './handler'
import { EditToolPresenter } from './presenter'
import { spec } from './spec'

export function createEditToolModule(): ToolModule {
  return {
    name: 'Edit',
    handler: createEditToolHandler(),
    presenter: EditToolPresenter,
    spec,
  }
}
