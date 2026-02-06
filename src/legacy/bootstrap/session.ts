import { findLatestSessionFile, readSessionFile } from '../../features/repl/sessionSave/index.js'

export async function resolveInitialSession(args: {
  cwd: string
  env: NodeJS.ProcessEnv
}): Promise<
  | {
      filePath: string
      messages: Awaited<ReturnType<typeof readSessionFile>>['messages']
      history: Awaited<ReturnType<typeof readSessionFile>>['history']
    }
  | null
> {
  const resumeLast = String(args.env.FORMAX_RESUME_LAST ?? '').trim() === '1'
  if (!resumeLast) return null

  try {
    const filePath = await findLatestSessionFile({ cwd: args.cwd, env: args.env })
    if (!filePath) return null
    const replay = await readSessionFile(filePath)
    return { filePath, messages: replay.messages, history: replay.history }
  } catch {
    return null
  }
}
