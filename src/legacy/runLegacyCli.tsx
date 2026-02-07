import { clearTerminal } from '../utils/terminal.js'
import { startConsoleLogger, stopConsoleLogger } from '../utils/consoleLogger.js'
import type { App } from '../core/app/createApp.js'
import { createRuntimeConfigContext } from './bootstrap/runtimeConfig.js'
import { createLlmClients } from './bootstrap/llmClients.js'
import { createToolingRuntime } from './bootstrap/tooling.js'
import { createPolicyAndHooksRuntime } from './bootstrap/policyHooks.js'
import { createSubagentRuntime } from './bootstrap/subagents.js'
import { createChatRuntime } from './bootstrap/chatRuntime.js'
import { resolveInitialSession } from './bootstrap/session.js'
import { renderReplApp } from './bootstrap/renderReplApp.js'
import { createRuntimeFlags } from '../env/runtimeFlags.js'
import { resetInkStaticOutputForStdout } from '../utils/inkStreams.js'

export async function runLegacyCli(_opts: { app?: App } = {}): Promise<void> {
  const enableLogger = process.env.ENABLE_CONSOLE_LOGGER !== 'false'
  if (enableLogger) {
    const port = parseInt(process.env.CONSOLE_LOGGER_PORT || '3001', 10)
    void port
    // startConsoleLogger(port)
  }

  await clearTerminal()

  let bootstrap: Awaited<ReturnType<typeof createRuntimeConfigContext>>
  try {
    bootstrap = await createRuntimeConfigContext({
      cwd: process.cwd(),
      env: process.env,
      onAfterSetupCompleted: async () => {
        await clearTerminal()
      },
    })
  } catch (err) {
    stopConsoleLogger()
    await clearTerminal()
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Error: ${message}\n`)
    process.exit(1)
    return
  }

  const { client, webFetchClient } = createLlmClients({ cfg: bootstrap.cfg, env: bootstrap.env })
  const tooling = createToolingRuntime({
    cwd: bootstrap.cwd,
    env: bootstrap.env,
    webFetchClient,
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
    client,
    toolRegistry: tooling.toolRegistry,
    taskManager: tooling.taskManager,
    preflight: policyHooks.preflight,
    createLocalExecutor: policyHooks.createExecutor,
  })
  const chatRuntime = createChatRuntime({
    client,
    toolRegistry: tooling.toolRegistry,
    preflight: policyHooks.preflight,
    hooks: policyHooks.hooks,
    audit: policyHooks.audit,
    runtimeFlags: createRuntimeFlags(bootstrap.env),
  })

  let replInstance: ReturnType<typeof renderReplApp> | null = null
  const onClearTerminal = async () => {
    // Keep Ink's frame state and terminal buffer in sync.
    await resetInkStaticOutputForStdout(process.stdout)
    if (replInstance) {
      replInstance.clear()
    }
    await clearTerminal()
  }
  const initialSession = await resolveInitialSession({ cwd: bootstrap.cwd, env: bootstrap.env })
  replInstance = renderReplApp({
    engine: chatRuntime.engine,
    tools: subagent.tools,
    cfg: bootstrap.cfg,
    initialSession,
    allowedSubagents: subagent.allowedSubagents,
    reloadSubagents: subagent.reloadSubagents,
    toolRegistry: tooling.toolRegistry,
    taskManager: tooling.taskManager,
    userInputManager: tooling.userInputManager,
    onClearTerminal,
    onExit: () => {
      // stopConsoleLogger()
      process.exit(0)
    },
  })
}
