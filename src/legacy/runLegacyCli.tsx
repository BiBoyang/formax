import { clearTerminal } from '../shared/utils/terminal.js'
import type { App } from '../core/app/createApp.js'
import { createRuntime } from '../runtime/createRuntime.js'
import { resolveInitialSession } from '../runtime/bootstrap/session.js'
import { renderReplApp } from '../runtime/bootstrap/renderReplApp.js'
import { resetInkStaticOutputForStdout } from '../shared/utils/inkStreams.js'

export async function runLegacyCli(opts: { app?: App; resumeLast?: boolean; forceSetup?: boolean } = {}): Promise<void> {
  await clearTerminal()

  let runtime: Awaited<ReturnType<typeof createRuntime>>
  try {
    runtime = await createRuntime({
      cwd: process.cwd(),
      env: process.env,
      forceSetup: opts.forceSetup === true,
      onAfterSetupCompleted: async () => {
        await clearTerminal()
      },
    })
  } catch (err) {
    await clearTerminal()
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Error: ${message}\n`)
    process.exit(1)
    return
  }

  const onClearTerminal = async () => {
    // Keep Ink's frame state and terminal buffer in sync.
    await resetInkStaticOutputForStdout(process.stdout)
    // Avoid clearing via Ink instance here: when a clear happens between two
    // equivalent frames, Ink can skip the next paint and leave a blank screen.
    await clearTerminal()
  }
  const initialSession = await resolveInitialSession({
    cwd: runtime.cwd,
    env: runtime.env,
    resumeLast: opts.resumeLast === true,
  })
  renderReplApp({
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
      process.exit(0)
    },
  })
}
