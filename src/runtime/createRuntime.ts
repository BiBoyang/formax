import { createRuntimeFlags, type RuntimeFlags } from '../env/runtimeFlags.js'
import { createChatRuntime } from '../legacy/bootstrap/chatRuntime.js'
import { createLlmClients, type LlmClients } from '../legacy/bootstrap/llmClients.js'
import { createPolicyAndHooksRuntime, type PolicyHooksRuntime } from '../legacy/bootstrap/policyHooks.js'
import { createRuntimeConfigContext } from '../legacy/bootstrap/runtimeConfig.js'
import type { BootstrapContext } from '../legacy/bootstrap/types.js'
import { createSubagentRuntime, type SubagentRuntime } from '../legacy/bootstrap/subagents.js'
import { createToolingRuntime, type ToolingRuntime } from '../legacy/bootstrap/tooling.js'

type ChatRuntime = ReturnType<typeof createChatRuntime>

export type RuntimeBundle = BootstrapContext &
  LlmClients &
  ToolingRuntime &
  PolicyHooksRuntime &
  SubagentRuntime &
  ChatRuntime & {
    runtimeFlags: RuntimeFlags
  }

export async function createRuntime(args: {
  cwd: string
  env: NodeJS.ProcessEnv
  onBeforeConfigLoad?: () => Promise<void>
  onAfterSetupCompleted?: () => Promise<void>
  runtimeFlags?: RuntimeFlags
}): Promise<RuntimeBundle> {
  const bootstrap = await createRuntimeConfigContext({
    cwd: args.cwd,
    env: args.env,
    onBeforeConfigLoad: args.onBeforeConfigLoad,
    onAfterSetupCompleted: args.onAfterSetupCompleted,
  })

  const llm = createLlmClients({ cfg: bootstrap.cfg, env: bootstrap.env })
  const tooling = createToolingRuntime({
    cwd: bootstrap.cwd,
    env: bootstrap.env,
    webFetchClient: llm.webFetchClient,
  })
  const policyHooks = createPolicyAndHooksRuntime({
    cfgPathsLogsDir: bootstrap.cfg.paths.logsDir,
    fileStore: bootstrap.fileStore,
    userInputManager: tooling.userInputManager,
    toolRegistry: tooling.toolRegistry,
    env: bootstrap.env,
  })
  const subagent = await createSubagentRuntime({
    cfg: bootstrap.cfg,
    env: bootstrap.env,
    cwd: bootstrap.cwd,
    client: llm.client,
    toolRegistry: tooling.toolRegistry,
    taskManager: tooling.taskManager,
    preflight: policyHooks.preflight,
    createLocalExecutor: policyHooks.createExecutor,
  })
  const runtimeFlags = args.runtimeFlags ?? createRuntimeFlags(bootstrap.env)
  const chatRuntime = createChatRuntime({
    client: llm.client,
    toolRegistry: tooling.toolRegistry,
    preflight: policyHooks.preflight,
    hooks: policyHooks.hooks,
    audit: policyHooks.audit,
    runtimeFlags,
  })

  return {
    ...bootstrap,
    ...llm,
    ...tooling,
    ...policyHooks,
    ...subagent,
    ...chatRuntime,
    runtimeFlags,
  }
}
