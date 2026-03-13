import type { ToolModule } from '../../registry'
import type { ToolHandler } from '../../executor'
import { TaskToolPresenter } from './presenter'
import { spec } from './spec'

export function createTaskToolModule(handler: ToolHandler): ToolModule {
  return {
    name: 'Task',
    handler,
    presenter: TaskToolPresenter,
    spec,
  }
}
