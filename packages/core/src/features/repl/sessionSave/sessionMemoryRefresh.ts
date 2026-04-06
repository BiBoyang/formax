import type { ChatHistory } from '../../../chat/engine'
import {
  buildSessionMemoryDraft,
  buildSessionMemoryRestoreReminderBlock,
  extractSessionMemoryRestoreState,
  type SessionMemoryDraft,
} from '../../../chat/context/sessionMemory'
import type { ReplMode } from '../mode'
import type { PromptBlock } from '../../../prompts'
import { readSessionMemoryFile, writeSessionMemoryFile } from './sessionMemorySidecar'

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

export async function resolveSessionMemoryRestoreContext(args: {
  sessionFilePath: string
  fallbackMode: ReplMode
  fallbackPlanPath: string | null
  readSessionMemoryFileImpl?: (sessionFilePath: string) => Promise<unknown>
}): Promise<{
  mode: ReplMode
  planPath: string | null
}> {
  let nextMode: ReplMode = args.fallbackMode
  let nextPlanPath = normalizePlanPath(args.fallbackPlanPath)

  try {
    const rawDraft = await (args.readSessionMemoryFileImpl ?? readSessionMemoryFile)(args.sessionFilePath)
    const restoreState = extractSessionMemoryRestoreState(rawDraft)
    if (restoreState) {
      if (nextMode === 'normal') {
        nextMode = restoreState.mode
      }
      if (nextPlanPath === null) {
        nextPlanPath = normalizePlanPath(restoreState.planPath)
      }
    }
  } catch {
    // Best-effort: fall back to the caller-provided context.
  }

  return {
    mode: nextMode,
    planPath: nextPlanPath,
  }
}

export async function buildSessionMemoryRestoreInjectedBlocks(args: {
  sessionFilePath: string
  readSessionMemoryFileImpl?: (sessionFilePath: string) => Promise<unknown>
}): Promise<PromptBlock[]> {
  try {
    const rawDraft = await (args.readSessionMemoryFileImpl ?? readSessionMemoryFile)(args.sessionFilePath)
    if (!isSessionMemoryDraft(rawDraft)) return []
    const reminderBlock = buildSessionMemoryRestoreReminderBlock(rawDraft)
    return reminderBlock ? [reminderBlock] : []
  } catch {
    return []
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

function normalizePlanPath(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isSessionMemoryDraft(value: unknown): value is SessionMemoryDraft {
  if (!value || typeof value !== 'object') return false
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion
  return schemaVersion === 1
}
