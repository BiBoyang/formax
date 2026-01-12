import type { ToolModule } from '../../registry'
import { GrepToolHandler } from './handler'
import { GrepToolPresenter } from './presenter'
import { spec } from './spec'

export const grepToolModule: ToolModule = {
  name: 'Grep',
  handler: GrepToolHandler,
  presenter: GrepToolPresenter,
  spec,
}
