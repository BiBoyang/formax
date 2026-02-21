import { useEffect, useRef } from 'react'
import type { SelectThreadOptions } from './threadActions'

const THREAD_QUERY_PARAM = 'thread'

function readThreadIdFromUrlDefault(): string | null {
  if (typeof window === 'undefined') return null
  const raw = new URL(window.location.href).searchParams.get(THREAD_QUERY_PARAM)
  if (!raw) return null
  const trimmed = raw.trim()
  return trimmed ? trimmed : null
}

function replaceThreadIdInUrlDefault(threadId: string | null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const current = url.searchParams.get(THREAD_QUERY_PARAM)
  if (threadId) {
    if (current === threadId) return
    url.searchParams.set(THREAD_QUERY_PARAM, threadId)
  } else {
    if (!current) return
    url.searchParams.delete(THREAD_QUERY_PARAM)
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

type ThreadUrlSyncAdapter = {
  readThreadIdFromUrl?: () => string | null
  replaceThreadIdInUrl?: (threadId: string | null) => void
}

type UseThreadUrlSyncArgs = {
  activeThreadId: string | null
  threads: Array<{ id: string }>
  selectThread: (threadId: string, options?: SelectThreadOptions) => void
  adapter?: ThreadUrlSyncAdapter
}

export function useThreadUrlSync(args: UseThreadUrlSyncArgs): void {
  const { activeThreadId, threads, selectThread, adapter } = args
  const hasInitializedThreadFromUrlRef = useRef(false)
  const pendingThreadIdFromUrlRef = useRef<string | null>(null)
  const readThreadIdFromUrl = adapter?.readThreadIdFromUrl ?? readThreadIdFromUrlDefault
  const replaceThreadIdInUrl = adapter?.replaceThreadIdInUrl ?? replaceThreadIdInUrlDefault

  useEffect(() => {
    if (hasInitializedThreadFromUrlRef.current) return
    const threadIdFromUrl = readThreadIdFromUrl()
    if (!threadIdFromUrl) {
      hasInitializedThreadFromUrlRef.current = true
      return
    }
    if (activeThreadId === threadIdFromUrl) {
      hasInitializedThreadFromUrlRef.current = true
      return
    }
    if (activeThreadId) {
      hasInitializedThreadFromUrlRef.current = true
      return
    }
    if (threads.length === 0) return
    const matched = threads.some((thread) => thread.id === threadIdFromUrl)
    hasInitializedThreadFromUrlRef.current = true
    if (!matched) {
      replaceThreadIdInUrl(null)
      return
    }
    pendingThreadIdFromUrlRef.current = threadIdFromUrl
    selectThread(threadIdFromUrl)
  }, [activeThreadId, readThreadIdFromUrl, replaceThreadIdInUrl, selectThread, threads])

  useEffect(() => {
    if (!hasInitializedThreadFromUrlRef.current) return
    const pending = pendingThreadIdFromUrlRef.current
    if (pending) {
      if (activeThreadId === pending) {
        pendingThreadIdFromUrlRef.current = null
      } else if (!activeThreadId) {
        return
      } else {
        pendingThreadIdFromUrlRef.current = null
      }
    }
    replaceThreadIdInUrl(activeThreadId)
  }, [activeThreadId, replaceThreadIdInUrl])
}
