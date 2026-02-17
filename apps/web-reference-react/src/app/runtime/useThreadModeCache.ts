import { useCallback } from 'react'
import { createInitialThreadRuntimeState, type ThreadRuntimeState } from '../../../../../src/features/semantics/runtime/threadRuntimeState'
import type { ReplMode } from '../../../../../src/features/semantics/core/replModeTransition'

export function useThreadModeCache(args: {
  runtimeStateByThreadRef: { current: Record<string, ThreadRuntimeState> }
  nowIso: () => string
}) {
  const { runtimeStateByThreadRef, nowIso } = args

  const cacheThreadMode = useCallback(
    (threadId: string | null | undefined, nextMode: ReplMode) => {
      if (!threadId) return
      const existing = runtimeStateByThreadRef.current[threadId]
      if (existing) {
        if (existing.mode === nextMode) return
        runtimeStateByThreadRef.current[threadId] = {
          ...existing,
          mode: nextMode,
          updatedAt: nowIso(),
        }
        return
      }

      const seed = createInitialThreadRuntimeState({
        threadId,
        replaySeq: 0,
        method: 'ui/modeSelected',
        ts: nowIso(),
      })
      runtimeStateByThreadRef.current[threadId] = {
        ...seed,
        mode: nextMode,
      }
    },
    [nowIso, runtimeStateByThreadRef],
  )

  return {
    cacheThreadMode,
  }
}
