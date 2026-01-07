import type { ToolModule } from '../../registry'
import { SearchToolPresenter } from './presenter'

export const searchToolModule: ToolModule = {
  name: 'Search',
  presenter: SearchToolPresenter,
}

