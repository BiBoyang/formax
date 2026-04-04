import { findLatestSessionFile, readSessionFile } from '../../features/repl/sessionSave/index.js'
import { buildActiveHistoryFromSessionReplay } from '../../chat/context/compact.js'

export async function resolveInitialSession(args: {
  cwd: string
  env: NodeJS.ProcessEnv
  resumeLast: boolean
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
    return {
      filePath,
      messages: replay.messages,
      history: buildActiveHistoryFromSessionReplay(replay.history),
    }
  } catch {
    return null
  }
}
