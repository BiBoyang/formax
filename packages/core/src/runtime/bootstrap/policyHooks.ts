import { createToolExecutor, type ToolPreflight } from '../../tools/executor/index.js'
import { createApprovalService } from '../../tools/executor/approvalService.js'
import { createPolicyPreflight } from '../../tools/executor/policyPreflight.js'
import { createSkillPreflight } from '../../tools/executor/skillPreflight.js'
import { createNodeAuditLog } from '../../adapters/audit/nodeAuditLog.js'
import { createHooksRuntime } from '../../hooks/runtime.js'
import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { UserInputManager } from '../../tools/runtime/userInputManager.js'
import type { McpServerManager } from '../../mcp/serverManager.js'

export type PolicyHooksRuntime = {
  audit: ReturnType<typeof createNodeAuditLog>
  hooks: ReturnType<typeof createHooksRuntime>
  preflight: ToolPreflight
  createExecutor: () => ReturnType<typeof createToolExecutor>
}

export function createPolicyAndHooksRuntime(args: {
  cfgPathsLogsDir: string
  fileStore: FileStore
  userInputManager: UserInputManager
  toolRegistry: ToolRegistry
  mcpServerManager?: McpServerManager
  env: NodeJS.ProcessEnv
}): PolicyHooksRuntime {
  const audit = createNodeAuditLog({ logsDir: args.cfgPathsLogsDir })
  const approval = createApprovalService({ fileStore: args.fileStore, userInput: args.userInputManager, audit })
  const policyPreflight = createPolicyPreflight({
    fileStore: args.fileStore,
    approval,
    audit,
    env: args.env,
    ...(args.mcpServerManager
      ? {
          isKnownMcpToolName: (toolName: string) =>
            args.mcpServerManager!.getCatalog().bindings.some((binding) => binding.modelName === toolName),
          getMcpToolInputSchema: (toolName: string) =>
            args.mcpServerManager!.getCatalog().bindings.find((binding) => binding.modelName === toolName)
              ?.definition.input_schema,
        }
      : {}),
  })
  const skillPreflight = createSkillPreflight({ fileStore: args.fileStore, userInput: args.userInputManager })
  const preflight: ToolPreflight = async (call, ctx) =>
    (await skillPreflight(call, ctx)) ?? policyPreflight(call, ctx)
  const hooks = createHooksRuntime({ fileStore: args.fileStore, env: args.env })

  return {
    audit,
    hooks,
    preflight,
    createExecutor: () => createToolExecutor(args.toolRegistry.getHandlers(), { preflight, audit }),
  }
}
