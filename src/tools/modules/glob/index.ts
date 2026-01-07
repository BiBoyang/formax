import type { ToolModule } from '../../registry'
import { GlobToolHandler } from './handler'
import { GlobToolPresenter } from './presenter'

export const globToolModule: ToolModule = {
  name: 'Glob',
  handler: GlobToolHandler,
  presenter: GlobToolPresenter,
}
