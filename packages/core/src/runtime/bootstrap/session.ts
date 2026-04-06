import { findLatestSessionFile, readSessionFile } from '../../features/repl/sessionSave/index.js'
import { persistSessionMemoryFromHistory } from '../../features/repl/sessionSave/sessionMemoryRefresh.js'
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
    await (args.persistSessionMemoryForRestore ?? persistSessionMemoryFromHistory)({
      sessionFilePath: filePath,
      cwd: args.cwd,
      mode: args.mode ?? 'normal',
      planPath: args.planPath ?? null,
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
