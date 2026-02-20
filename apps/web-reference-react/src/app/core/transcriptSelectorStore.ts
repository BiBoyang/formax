import type { TranscriptItem } from '../../types'

export type TranscriptSelectorSnapshot = {
  activeThreadId: string | null
  logs: TranscriptItem[]
  logsByThreadId: Record<string, TranscriptItem[]>
}

type SelectorFn<T> = (snapshot: TranscriptSelectorSnapshot) => T

type SelectorCacheEntry = {
  activeThreadId: string | null
  logs: TranscriptItem[]
  logsByThreadId: Record<string, TranscriptItem[]>
  value: unknown
}

export type TranscriptSelectorStore = {
  select: <T>(selector: SelectorFn<T>, snapshot: TranscriptSelectorSnapshot) => T
  clear: () => void
}

function isSameSnapshot(a: TranscriptSelectorSnapshot, b: SelectorCacheEntry): boolean {
  return a.activeThreadId === b.activeThreadId && a.logs === b.logs && a.logsByThreadId === b.logsByThreadId
}

export function createTranscriptSelectorStore(): TranscriptSelectorStore {
  const selectorCache = new Map<SelectorFn<unknown>, SelectorCacheEntry>()

  const select = <T>(selector: SelectorFn<T>, snapshot: TranscriptSelectorSnapshot): T => {
    const cached = selectorCache.get(selector as SelectorFn<unknown>)
    if (cached && isSameSnapshot(snapshot, cached)) {
      return cached.value as T
    }

    const value = selector(snapshot)
    selectorCache.set(selector as SelectorFn<unknown>, {
      activeThreadId: snapshot.activeThreadId,
      logs: snapshot.logs,
      logsByThreadId: snapshot.logsByThreadId,
      value,
    })
    return value
  }

  const clear = () => {
    selectorCache.clear()
  }

  return {
    select,
    clear,
  }
}
