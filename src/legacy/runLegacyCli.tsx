import { clearTerminal } from '../utils/terminal.js'
import { startConsoleLogger, stopConsoleLogger } from '../utils/consoleLogger.js'
import type { App } from '../core/app/createApp.js'
import { createRuntime } from '../runtime/createRuntime.js'
import { resolveInitialSession } from './bootstrap/session.js'
import { renderReplApp } from './bootstrap/renderReplApp.js'
import { resetInkStaticOutputForStdout } from '../utils/inkStreams.js'

export async function runLegacyCli(_opts: { app?: App } = {}): Promise<void> {
  const enableLogger = process.env.ENABLE_CONSOLE_LOGGER !== 'false'
  if (enableLogger) {
    const port = parseInt(process.env.CONSOLE_LOGGER_PORT || '3001', 10)
    void port
    // startConsoleLogger(port)
  }

  await clearTerminal()

  let runtime: Awaited<ReturnType<typeof createRuntime>>
  try {
    runtime = await createRuntime({
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

  let replInstance: ReturnType<typeof renderReplApp> | null = null
  const onClearTerminal = async () => {
    // Keep Ink's frame state and terminal buffer in sync.
    await resetInkStaticOutputForStdout(process.stdout)
    if (replInstance) {
      replInstance.clear()
    }
    await clearTerminal()
  }
  const initialSession = await resolveInitialSession({ cwd: runtime.cwd, env: runtime.env })
  replInstance = renderReplApp({
    engine: runtime.engine,
    tools: runtime.tools,
    cfg: runtime.cfg,
    initialSession,
    allowedSubagents: runtime.allowedSubagents,
    reloadSubagents: runtime.reloadSubagents,
    toolRegistry: runtime.toolRegistry,
    taskManager: runtime.taskManager,
    userInputManager: runtime.userInputManager,
    onClearTerminal,
    onExit: () => {
      // stopConsoleLogger()
      process.exit(0)
    },
  })
}
