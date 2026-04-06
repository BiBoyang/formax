import type { ChatHistory } from '../../../chat/engine'
import { buildSessionMemoryDraft } from '../../../chat/context/sessionMemory'
import type { ReplMode } from '../mode'
import { writeSessionMemoryFile } from './sessionMemorySidecar'

const sessionMemoryWriteQueue = new Map<string, Promise<void>>()

export type PersistSessionMemoryFromHistoryArgs = {
  sessionFilePath: string
  cwd: string
  mode: ReplMode
  planPath: string | null
  history: ChatHistory
}

export async function waitForSessionMemoryWriteFlush(sessionFilePath: string): Promise<void> {
  const pending = sessionMemoryWriteQueue.get(sessionFilePath)
  if (!pending) return
  try {
    await pending
  } catch {
    // Best-effort: callers should fall back if the sidecar remains unavailable.
  }
}

export async function persistSessionMemoryFromHistory(
  args: PersistSessionMemoryFromHistoryArgs,
): Promise<void> {
  const previous = sessionMemoryWriteQueue.get(args.sessionFilePath) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const draft = buildSessionMemoryDraft({
        cwd: args.cwd,
        mode: args.mode,
        planPath: args.planPath,
        previousHistory: args.history,
      })

      await writeSessionMemoryFile({
        sessionFilePath: args.sessionFilePath,
        draft,
      })
    })

  sessionMemoryWriteQueue.set(args.sessionFilePath, next)
  try {
    await next
  } finally {
    if (sessionMemoryWriteQueue.get(args.sessionFilePath) === next) {
      sessionMemoryWriteQueue.delete(args.sessionFilePath)
    }
  }
}
