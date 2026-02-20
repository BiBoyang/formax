import { useEffect, useMemo } from 'react'
import type { ThreadSummary } from '../../types'
import { selectSortedThreadViewModels } from '../core/threadViewModel'

export function useThreadSelection(args: {
  threads: ThreadSummary[]
  activeThreadId: string | null
  selectedCwd: string | null
  setSelectedCwd: (cwd: string | null) => void
}) {
  const { threads, activeThreadId, selectedCwd, setSelectedCwd } = args

  const sortedThreads = useMemo(
    () => selectSortedThreadViewModels(threads),
    [threads],
  )

  const cwdOptions = useMemo(() => {
    const seen = new Set<string>()
    const values: string[] = []
    for (const thread of sortedThreads) {
      const cwd = typeof thread.cwd === 'string' ? thread.cwd : ''
      if (!cwd || seen.has(cwd)) continue
      seen.add(cwd)
      values.push(cwd)
    }
    return values
  }, [sortedThreads])

  useEffect(() => {
    const activeThread = activeThreadId ? threads.find((thread) => thread.id === activeThreadId) : null
    if (activeThread?.cwd && activeThread.cwd !== selectedCwd) {
      setSelectedCwd(activeThread.cwd)
      return
    }

    if (selectedCwd && cwdOptions.includes(selectedCwd)) return
    const fallback = cwdOptions[0] ?? null
    if (fallback !== selectedCwd) {
      setSelectedCwd(fallback)
    }
  }, [activeThreadId, cwdOptions, selectedCwd, setSelectedCwd, threads])

  return {
    sortedThreads,
    cwdOptions,
  }
}
