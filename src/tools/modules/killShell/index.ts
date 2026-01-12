import type { ToolModule } from '../../registry'
import type { TaskManager } from '../../runtime/taskManager'
import { createKillShellToolHandler } from './handler'
import { KillShellToolPresenter } from './presenter'
import { spec } from './spec'

export function createKillShellToolModule(taskManager: TaskManager): ToolModule {
  return {
    name: 'KillShell',
    handler: createKillShellToolHandler(taskManager),
    presenter: KillShellToolPresenter,
    spec,
  }
}
