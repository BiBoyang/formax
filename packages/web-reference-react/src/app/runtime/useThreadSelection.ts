import { useEffect, useMemo, useRef } from 'react'
import type { ThreadSummary } from '../../types'
import { selectSortedThreadViewModels } from '../core/threadViewModel'

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}

export function useThreadSelection(args: {
  threads: ThreadSummary[]
  activeThreadId: string | null
  selectedCwd: string | null
  setSelectedCwd: (cwd: string | null) => void
  suspendAutoSelection?: boolean
}) {
  const { threads, activeThreadId, selectedCwd, setSelectedCwd, suspendAutoSelection = false } = args
  const cwdOptionsRef = useRef<string[]>([])

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
    if (areStringArraysEqual(cwdOptionsRef.current, values)) {
      return cwdOptionsRef.current
    }
    cwdOptionsRef.current = values
    return values
  }, [sortedThreads])
  const cwdOptionSet = useMemo(() => new Set(cwdOptions), [cwdOptions])
  const threadById = useMemo(() => {
    const index = new Map<string, ThreadSummary>()
    for (const thread of threads) {
      index.set(thread.id, thread)
    }
    return index
  }, [threads])

  useEffect(() => {
    if (suspendAutoSelection) return
    if (selectedCwd && cwdOptionSet.has(selectedCwd)) return

    const activeThread = activeThreadId ? threadById.get(activeThreadId) ?? null : null
    if (activeThread?.cwd && activeThread.cwd !== selectedCwd && cwdOptionSet.has(activeThread.cwd)) {
      setSelectedCwd(activeThread.cwd)
      return
    }

    const fallback = cwdOptions[0] ?? null
    if (fallback !== selectedCwd) {
      setSelectedCwd(fallback)
    }
  }, [activeThreadId, cwdOptionSet, cwdOptions, selectedCwd, setSelectedCwd, suspendAutoSelection, threadById])

  return {
    sortedThreads,
    cwdOptions,
  }
}
