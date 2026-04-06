import type { ChatHistory } from '../../../../chat/engine'
import type { ReplMode } from '../../mode'
import {
  persistSessionMemoryFromHistory,
  waitForSessionMemoryWriteFlush,
} from '../../sessionSave/sessionMemoryRefresh'

export async function waitForRollingSessionMemoryFlush(sessionFilePath: string): Promise<void> {
  await waitForSessionMemoryWriteFlush(sessionFilePath)
}

export async function persistRollingSessionMemory(args: {
  sessionFilePath: string
  cwd: string
  mode: ReplMode
  planPath: string | null
  history: ChatHistory
}): Promise<void> {
  await persistSessionMemoryFromHistory(args)
}
