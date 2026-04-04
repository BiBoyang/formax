import type { ChatHistory } from '../../../../chat/engine'
import type { ReplMode } from '../../mode'
import { buildSessionMemoryDraft } from '../../../../chat/context/sessionMemory'
import { writeSessionMemoryFile } from '../../sessionSave/sessionMemorySidecar'

const rollingMemoryWriteQueue = new Map<string, Promise<void>>()

export async function waitForRollingSessionMemoryFlush(sessionFilePath: string): Promise<void> {
  const pending = rollingMemoryWriteQueue.get(sessionFilePath)
  if (!pending) return
  try {
    await pending
  } catch {
    // Best-effort: callers will fall back if the sidecar remains unavailable.
  }
}

export async function persistRollingSessionMemory(args: {
  sessionFilePath: string
  cwd: string
  mode: ReplMode
  planPath: string | null
  history: ChatHistory
}): Promise<void> {
  const previous = rollingMemoryWriteQueue.get(args.sessionFilePath) ?? Promise.resolve()
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

  rollingMemoryWriteQueue.set(args.sessionFilePath, next)
  try {
    await next
  } finally {
    if (rollingMemoryWriteQueue.get(args.sessionFilePath) === next) {
      rollingMemoryWriteQueue.delete(args.sessionFilePath)
    }
  }
}
