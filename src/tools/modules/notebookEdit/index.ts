import type { ToolModule } from '../../registry'
import { createNotebookEditToolHandler } from './handler'
import { NotebookEditToolPresenter } from './presenter'
import { spec } from './spec'

export function createNotebookEditToolModule(): ToolModule {
  return {
    name: 'NotebookEdit',
    handler: createNotebookEditToolHandler(),
    presenter: NotebookEditToolPresenter,
    spec,
  }
}
