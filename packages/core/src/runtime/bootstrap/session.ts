import { findLatestSessionFile, readSessionFile } from '../../features/repl/sessionSave/index.js'
import {
  buildSessionMemoryRestoreInjectedBlocks,
  persistSessionMemoryFromHistory,
  resolveSessionMemoryRestoreContext,
} from '../../features/repl/sessionSave/sessionMemoryRefresh.js'
import { buildActiveHistoryFromSessionReplay } from '../../chat/context/compact.js'
import type { PromptBlock } from '../../prompts/index.js'

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
      nextTurnInjectedBlocks?: PromptBlock[]
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
    const nextTurnInjectedBlocks = await buildSessionMemoryRestoreInjectedBlocks({
      sessionFilePath: filePath,
    })
    return {
      filePath,
      messages: replay.messages,
      history,
      ...(nextTurnInjectedBlocks.length > 0 ? { nextTurnInjectedBlocks } : {}),
    }
  } catch {
    return null
  }
}
