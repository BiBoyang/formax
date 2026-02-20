import type { TranscriptItem } from '../../types'
import type { ThreadTranscriptSource } from './replayMachine'

export type ThreadCacheState = {
  logsByThreadId: Record<string, TranscriptItem[]>
  historyCursorByThreadId: Record<string, string | null>
  transcriptSourceByThreadId: Record<string, ThreadTranscriptSource>
}

export const INITIAL_THREAD_CACHE_STATE: ThreadCacheState = {
  logsByThreadId: {},
  historyCursorByThreadId: {},
  transcriptSourceByThreadId: {},
}

export function withThreadCacheSlice<K extends keyof ThreadCacheState>(
  cache: ThreadCacheState,
  key: K,
  nextSlice: ThreadCacheState[K],
): ThreadCacheState {
  if (cache[key] === nextSlice) return cache
  return {
    ...cache,
    [key]: nextSlice,
  }
}
