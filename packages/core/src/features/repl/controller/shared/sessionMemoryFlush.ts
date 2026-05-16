import { waitForSessionMemoryWriteFlush } from '../../sessionSave/sessionMemoryRefresh'

export async function waitForRollingSessionMemoryFlush(sessionFilePath: string): Promise<void> {
  await waitForSessionMemoryWriteFlush(sessionFilePath)
}
