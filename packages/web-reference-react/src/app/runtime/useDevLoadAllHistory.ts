import { useCallback, useEffect, useState } from 'react'

type UseDevLoadAllHistoryArgs = {
  enabled: boolean
  activeThreadId: string | null
  activeHistoryLoading: boolean
  historyMore: boolean
  loadEarlierHistory: () => Promise<void>
}

type UseDevLoadAllHistoryResult = {
  running: boolean
  requestStart: () => void
}

export function useDevLoadAllHistory(args: UseDevLoadAllHistoryArgs): UseDevLoadAllHistoryResult {
  const [requested, setRequested] = useState(false)
  const [bootstrapAttempts, setBootstrapAttempts] = useState(0)
  const [sawHistoryLoading, setSawHistoryLoading] = useState(false)

  const setRequestedStable = useCallback((next: boolean) => {
    setRequested((previous) => (previous === next ? previous : next))
  }, [])
  const setBootstrapAttemptsStable = useCallback((next: number) => {
    setBootstrapAttempts((previous) => (previous === next ? previous : next))
  }, [])
  const setSawHistoryLoadingStable = useCallback((next: boolean) => {
    setSawHistoryLoading((previous) => (previous === next ? previous : next))
  }, [])

  const reset = useCallback(() => {
    setRequestedStable(false)
    setBootstrapAttemptsStable(0)
    setSawHistoryLoadingStable(false)
  }, [setBootstrapAttemptsStable, setRequestedStable, setSawHistoryLoadingStable])

  const requestStart = useCallback(() => {
    if (!args.enabled) return
    if (!args.activeThreadId) return
    setRequestedStable(true)
    setBootstrapAttemptsStable(0)
    setSawHistoryLoadingStable(false)
  }, [args.activeThreadId, args.enabled, setBootstrapAttemptsStable, setRequestedStable, setSawHistoryLoadingStable])

  const runStep = useCallback(() => {
    void args.loadEarlierHistory().catch(() => {
      reset()
    })
  }, [args.loadEarlierHistory, reset])

  useEffect(() => {
    reset()
  }, [args.activeThreadId, reset])

  useEffect(() => {
    if (!args.enabled) return
    if (!requested) return

    if (!args.activeThreadId) {
      reset()
      return
    }

    if (args.activeHistoryLoading) {
      if (!sawHistoryLoading) {
        setSawHistoryLoadingStable(true)
      }
      return
    }

    if (args.historyMore) {
      runStep()
      return
    }

    if (bootstrapAttempts === 0) {
      setBootstrapAttemptsStable(1)
      runStep()
      return
    }

    if (bootstrapAttempts === 1 && sawHistoryLoading) {
      setBootstrapAttemptsStable(2)
      runStep()
      return
    }

    reset()
  }, [
    args.activeHistoryLoading,
    args.activeThreadId,
    args.enabled,
    args.historyMore,
    bootstrapAttempts,
    requested,
    runStep,
    sawHistoryLoading,
    setBootstrapAttemptsStable,
    setSawHistoryLoadingStable,
    reset,
  ])

  return {
    running: requested,
    requestStart,
  }
}
