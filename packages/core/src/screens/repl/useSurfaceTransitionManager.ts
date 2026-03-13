import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

type SurfaceActions = {
  resetTranscriptSurface: () => Promise<void>
}

export function useSurfaceTransitionManager(args: {
  actions: SurfaceActions
  isPromptMode: boolean
  expandedTranscriptOpen: boolean
  setExpandedTranscriptOpen: Dispatch<SetStateAction<boolean>>
  expandedTranscriptHideHistory: boolean
  setExpandedTranscriptHideHistory: Dispatch<SetStateAction<boolean>>
  expandedViewActive: boolean
  lastCompactBoundaryIndex: number
}): {
  handleToggleExpandedTranscript: () => void
} {
  const {
    actions,
    isPromptMode,
    expandedTranscriptOpen,
    setExpandedTranscriptOpen,
    expandedTranscriptHideHistory,
    setExpandedTranscriptHideHistory,
    expandedViewActive,
    lastCompactBoundaryIndex,
  } = args

  const lastCompactBoundaryRef = useRef<number | null>(null)
  const lastExpandedHideHistoryRef = useRef<boolean | null>(null)
  const lastExpandedViewActiveRef = useRef<boolean | null>(null)
  const resetLoopRunningRef = useRef(false)
  const resetPendingRef = useRef(false)

  const requestSurfaceReset = useCallback(() => {
    resetPendingRef.current = true
    if (resetLoopRunningRef.current) return

    resetLoopRunningRef.current = true
    void (async () => {
      try {
        while (resetPendingRef.current) {
          resetPendingRef.current = false
          try {
            await actions.resetTranscriptSurface()
          } catch {
            // Keep the reset loop alive across transient clear/reset failures.
          }
        }
      } finally {
        resetLoopRunningRef.current = false
      }
    })()
  }, [actions])

  useEffect(() => {
    if (!expandedTranscriptOpen) setExpandedTranscriptHideHistory(false)
  }, [expandedTranscriptOpen, setExpandedTranscriptHideHistory])

  useEffect(() => {
    const prev = lastExpandedViewActiveRef.current
    lastExpandedViewActiveRef.current = expandedViewActive
    if (prev === null || prev === expandedViewActive) return

    // View switch transactions are driven by committed state, not key handlers.
    requestSurfaceReset()
  }, [expandedViewActive, requestSurfaceReset])

  useEffect(() => {
    const prevBoundary = lastCompactBoundaryRef.current
    lastCompactBoundaryRef.current = lastCompactBoundaryIndex
    if (prevBoundary === null) return

    // Compact inserts a new boundary. Primary transcript uses slicing, so we
    // remount Static once here to keep the physical terminal surface in sync.
    if (lastCompactBoundaryIndex > prevBoundary && !expandedViewActive) {
      requestSurfaceReset()
    }
  }, [expandedViewActive, lastCompactBoundaryIndex, requestSurfaceReset])

  useEffect(() => {
    const prev = lastExpandedHideHistoryRef.current
    lastExpandedHideHistoryRef.current = expandedTranscriptHideHistory
    if (prev === null || prev === expandedTranscriptHideHistory) return
    if (!expandedViewActive) return

    // Ctrl+E changes the visible expanded slice; force a remount to avoid
    // stale static rows from the previous fold state.
    requestSurfaceReset()
  }, [expandedTranscriptHideHistory, expandedViewActive, requestSurfaceReset])

  const handleToggleExpandedTranscript = useCallback(() => {
    if (isPromptMode) return

    setExpandedTranscriptOpen((prev) => !prev)
  }, [isPromptMode, setExpandedTranscriptOpen])

  return {
    handleToggleExpandedTranscript,
  }
}
