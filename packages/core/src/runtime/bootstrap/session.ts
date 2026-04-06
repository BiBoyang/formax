import { findLatestSessionFile, readSessionFile } from '../../features/repl/sessionSave/index.js'
import {
  persistSessionMemoryFromHistory,
  resolveSessionMemoryRestoreContext,
} from '../../features/repl/sessionSave/sessionMemoryRefresh.js'
import { buildActiveHistoryFromSessionReplay } from '../../chat/context/compact.js'

export async function resolveInitialSession(args: {
  cwd: string
  env: NodeJS.ProcessEnv
  resumeLast: boolean
  mode?: 'normal' | 'acceptEdits' | 'plan'
  planPath?: string | null
  persistSessionMemoryForRestore?: typeof persistSessionMemoryFromHistory
}): Promise<
  | {
      filePath: string
      messages: Awaited<ReturnType<typeof readSessionFile>>['messages']
      history: Awaited<ReturnType<typeof readSessionFile>>['history']
    }
  | null
> {
  if (!args.resumeLast) return null

  try {
    const filePath = await findLatestSessionFile({ cwd: args.cwd, env: args.env })
    if (!filePath) return null
    const replay = await readSessionFile(filePath)
    const history = buildActiveHistoryFromSessionReplay(replay.history)
    const restoreContext = await resolveSessionMemoryRestoreContext({
      sessionFilePath: filePath,
      fallbackMode: args.mode ?? 'normal',
      fallbackPlanPath: args.planPath ?? null,
    })
    await (args.persistSessionMemoryForRestore ?? persistSessionMemoryFromHistory)({
      sessionFilePath: filePath,
      cwd: args.cwd,
      mode: restoreContext.mode,
      planPath: restoreContext.planPath,
      history,
    }).catch(() => undefined)
    return {
      filePath,
      messages: replay.messages,
      history,
    }
  } catch {
    return null
  }
}
