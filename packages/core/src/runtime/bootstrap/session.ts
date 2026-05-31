import { findLatestSessionFile, readSessionFile } from '../../features/repl/sessionSave/index.js'
import {
  persistSessionMemoryFromHistory,
  resolveSessionMemoryRestoreArtifacts,
} from '../../features/repl/sessionRestore/sessionMemory.js'
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
      replayHistory: Awaited<ReturnType<typeof readSessionFile>>['history']
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
    const restoreArtifacts = await resolveSessionMemoryRestoreArtifacts({
      sessionFilePath: filePath,
      fallbackMode: args.mode ?? 'normal',
      fallbackPlanPath: args.planPath ?? null,
    })
    await (args.persistSessionMemoryForRestore ?? persistSessionMemoryFromHistory)({
      sessionFilePath: filePath,
      cwd: args.cwd,
      mode: restoreArtifacts.mode,
      planPath: restoreArtifacts.planPath,
      history,
    }).catch(() => undefined)
    return {
      filePath,
      messages: replay.messages,
      history,
      replayHistory: replay.history,
      ...(restoreArtifacts.nextTurnInjectedBlocks.length > 0
        ? { nextTurnInjectedBlocks: restoreArtifacts.nextTurnInjectedBlocks }
        : {}),
    }
  } catch {
    return null
  }
}
