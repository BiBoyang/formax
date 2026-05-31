import { waitForSessionMemoryWriteFlush } from '../../sessionRestore/sessionMemory'

export async function waitForRollingSessionMemoryFlush(sessionFilePath: string): Promise<void> {
  await waitForSessionMemoryWriteFlush(sessionFilePath)
}
