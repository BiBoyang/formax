import { createRuntimeFlags, type RuntimeFlags } from '../config/runtimeFlags.js'
import { createChatRuntime } from './bootstrap/chatRuntime.js'
import { createLlmClients, type LlmClients } from './bootstrap/llmClients.js'
import { createPolicyAndHooksRuntime, type PolicyHooksRuntime } from './bootstrap/policyHooks.js'
import { createRuntimeConfigContext } from './bootstrap/runtimeConfig.js'
import type { BootstrapContext } from './bootstrap/types.js'
import { createSubagentRuntime, type SubagentRuntime } from './bootstrap/subagents.js'
import { createToolingRuntime, type ToolingRuntime } from './bootstrap/tooling.js'
import { resolveMcpConfigForEntrypoint, type McpRuntimeEntrypoint } from '../mcp/entrypointConfig.js'
import { McpServerManager } from '../mcp/serverManager.js'
import { createSdkMcpClientFactory } from '../mcp/sdkClient.js'
import { createFileBackedMcpBlobWriter } from '../mcp/blobWriter.js'
import type { McpClientFactory } from '../mcp/client.js'
import type { McpConfig } from '../mcp/types.js'

type ChatRuntime = ReturnType<typeof createChatRuntime>

const REPL_MCP_FIRST_TURN_ACTIVATION_WAIT_MS = 1500

export type RuntimeBundle = BootstrapContext &
  LlmClients &
  ToolingRuntime &
  PolicyHooksRuntime &
  SubagentRuntime &
  ChatRuntime & {
    runtimeFlags: RuntimeFlags
    dispose: () => Promise<void>
  }

export async function createRuntime(args: {
  cwd: string
  env: NodeJS.ProcessEnv
  forceSetup?: boolean
  onBeforeConfigLoad?: () => Promise<void>
  onAfterSetupCompleted?: () => Promise<void>
  runtimeFlags?: RuntimeFlags
  mcpRuntimeEntrypoint?: McpRuntimeEntrypoint
  mcpServersOverlay?: unknown
  mcpClientFactory?: McpClientFactory
}): Promise<RuntimeBundle> {
  const mcpRuntimeEntrypoint = args.mcpRuntimeEntrypoint ?? 'repl'
  const bootstrap = await createRuntimeConfigContext({
    cwd: args.cwd,
    env: args.env,
    forceSetup: args.forceSetup === true,
    loadMcpConfig: mcpRuntimeEntrypoint === 'repl',
    onBeforeConfigLoad: args.onBeforeConfigLoad,
    onAfterSetupCompleted: args.onAfterSetupCompleted,
  })

  const llm = createLlmClients({ cfg: bootstrap.cfg, env: bootstrap.env })
  const mcpServerManager = new McpServerManager({
    config: resolveMcpConfigForRuntime({
      entrypoint: mcpRuntimeEntrypoint,
      cfgMcp: bootstrap.cfg.mcp,
      overlayConfig: args.mcpServersOverlay,
    }),
    clientFactory: args.mcpClientFactory ?? createSdkMcpClientFactory({ cwd: bootstrap.cwd, env: bootstrap.env }),
    blobWriter: createFileBackedMcpBlobWriter({ rootDir: bootstrap.cfg.paths.logsDir }),
  })
  let mcpActivationController: AbortController | undefined
  let mcpActivation: Promise<void> | undefined
  try {
    const tooling = createToolingRuntime({
      cwd: bootstrap.cwd,
      env: bootstrap.env,
      webFetchClient: llm.webFetchClient,
      mcpServerManager,
    })
    if (mcpRuntimeEntrypoint === 'sdk') {
      await mcpServerManager.activate()
    }
    const policyHooks = createPolicyAndHooksRuntime({
      cfgPathsLogsDir: bootstrap.cfg.paths.logsDir,
      fileStore: bootstrap.fileStore,
      userInputManager: tooling.userInputManager,
      toolRegistry: tooling.toolRegistry,
      mcpServerManager: tooling.mcpServerManager,
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
    if (mcpRuntimeEntrypoint === 'repl') {
      mcpActivationController = new AbortController()
      mcpActivation = mcpServerManager
        .activate(mcpActivationController.signal)
        .then(() => subagent.refreshTools(), () => undefined)
        .then(() => undefined, () => undefined)
    }
    const waitForMcpActivation = createMcpActivationWaiter(() => mcpActivation)
    const engine = mcpRuntimeEntrypoint === 'repl'
      ? {
          ...chatRuntime.engine,
          prepareTurn: async () => {
            await waitForMcpActivation()
          },
        }
      : chatRuntime.engine

    return {
      ...bootstrap,
      ...llm,
      ...tooling,
      ...policyHooks,
      ...subagent,
      ...chatRuntime,
      engine,
      runtimeFlags,
      dispose: async () => {
        mcpActivationController?.abort()
        void mcpActivation
        await mcpServerManager.dispose()
      },
    }
  } catch (error) {
    mcpActivationController?.abort()
    void mcpActivation
    await mcpServerManager.dispose()
    throw error
  }
}

function resolveMcpConfigForRuntime(args: {
  entrypoint: McpRuntimeEntrypoint
  cfgMcp?: McpConfig
  overlayConfig?: unknown
}): McpConfig {
  if (args.entrypoint === 'repl') return args.cfgMcp ?? { servers: {} }
  // Phase 1A contract: SDK and app-server must not consume persisted user/project MCP config.
  const resolved = resolveMcpConfigForEntrypoint({
    entrypoint: args.entrypoint,
    overlayConfig: args.overlayConfig,
  })
  if (resolved.ok === true) return resolved.config
  throw new Error(`Invalid MCP config: ${resolved.issues.join('; ')}`)
}

function createMcpActivationWaiter(getActivation: () => Promise<void> | undefined): () => Promise<void> {
  let settled = false
  return async () => {
    const activation = getActivation()
    if (!activation || settled) return
    const waitForActivation = activation.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await Promise.race([
      waitForActivation,
      mcpActivationGraceTimeout(),
    ])
  }
}

function mcpActivationGraceTimeout(): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, REPL_MCP_FIRST_TURN_ACTIVATION_WAIT_MS)
    const unref = (timeout as { unref?: () => void }).unref
    if (typeof unref === 'function') unref.call(timeout)
  })
}
