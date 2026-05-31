import type { ChatHistory } from '../../../../chat/engine'
import type { ReplMode } from '../../mode'
import { persistSessionMemoryFromHistory } from '../../sessionRestore/sessionMemory'

export async function persistRollingSessionMemory(args: {
  sessionFilePath: string
  cwd: string
  mode: ReplMode
  planPath: string | null
  history: ChatHistory
}): Promise<void> {
  await persistSessionMemoryFromHistory(args)
}
