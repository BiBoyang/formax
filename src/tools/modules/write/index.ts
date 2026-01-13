import type { ToolModule } from '../../registry'
import { createWriteToolHandler } from './handler'
import { WriteToolPresenter } from './presenter'
import { spec } from './spec'

export function createWriteToolModule(): ToolModule {
  return {
    name: 'Write',
    handler: createWriteToolHandler(),
    presenter: WriteToolPresenter,
    spec,
  }
}
