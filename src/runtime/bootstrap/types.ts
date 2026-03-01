import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import type { RuntimeConfig } from '../../config/config.js'
import type { ChatEngine } from '../../chat/engine.js'
import type { HooksRuntime } from '../../hooks/runtime.js'
import type { ToolPreflight, ToolExecutor } from '../../tools/executor/index.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { TaskManager } from '../../tools/runtime/taskManager.js'
import type { UserInputManager } from '../../tools/runtime/userInputManager.js'
import type { SubAgentRunner } from '../../subagents/runner.js'

export type BootstrapContext = {
  cwd: string
  env: NodeJS.ProcessEnv
  fileStore: FileStore
  cfg: RuntimeConfig
}

export type ToolingContext = {
  toolRegistry: ToolRegistry
  taskManager: TaskManager
  userInputManager: UserInputManager
  preflight: ToolPreflight
  audit: AuditLog
}

export type RuntimeServices = {
  engine: ChatEngine
  hooks: HooksRuntime
  executor: ToolExecutor
  subAgentRunner: SubAgentRunner
}
