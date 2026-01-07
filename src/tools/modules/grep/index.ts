import type { ToolModule } from '../../registry'
import { GrepToolHandler } from './handler'
import { GrepToolPresenter } from './presenter'

export const grepToolModule: ToolModule = {
  name: 'Grep',
  handler: GrepToolHandler,
  presenter: GrepToolPresenter,
}
