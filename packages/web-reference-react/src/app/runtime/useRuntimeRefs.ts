/**
 * Runtime Refs - Semantic Grouping
 *
 * 将 useAppRuntime 中的 Refs 按语义分组，降低主 hook 的复杂度
 */

import { useRef, useEffect } from 'react'
import { createTurnEventCursorState } from '../../turnEventCursor'
import type { RpcClient } from '../../rpcClient'
import { SEEN_EVENT_CAP } from '../core/constants'
import type {
  CompactBoundarySummary,
  DurableSnipSummary,
  RequestCollapseSummary,
  SessionMemoryRestoreSummary,
  ThreadSummary,
} from '../../types'
import type { TranscriptItem } from '../../types'
import type { ThreadTranscriptSource } from '../core/replayMachine'
import type { ThreadRuntimeState } from '../../semantics'

/**
 * RPC & 连接层 Refs
 */
export interface RpcRefs {
  clientRef: React.RefObject<RpcClient | null>
  eventCursorRef: React.RefObject<ReturnType<typeof createTurnEventCursorState>>
  commandByTurnRef: React.RefObject<Map<string, string>>
}

/**
 * 创建 RPC 相关的 Refs
 *
 * ✅ Hook 顶层调用 useRef（符合 Hooks 规则）
 */
export function useRpcRefs(): RpcRefs {
  const clientRef = useRef<RpcClient | null>(null)
  const eventCursorRef = useRef(createTurnEventCursorState(SEEN_EVENT_CAP))
  const commandByTurnRef = useRef<Map<string, string>>(new Map())

  return { clientRef, eventCursorRef, commandByTurnRef }
}

/**
 * 线程状态快照 Refs（防 stale closure）
 *
 * 用途：在异步回调中访问最新的线程状态，避免闭包陷阱
 */
export interface ThreadSnapshotRefs {
  activeThreadIdRef: React.RefObject<string | null>
  threadsRef: React.RefObject<ThreadSummary[]>
  selectedCwdRef: React.RefObject<string | null>
  selectedInputIdRef: React.RefObject<string | null>
  stateLogsRef: React.RefObject<TranscriptItem[]>
}

/**
 * 创建线程状态快照 Refs
 *
 * 封装 Refs 的同步逻辑，避免分散在多个 useEffect 中
 */
export function useThreadSnapshotRefs(
  activeThreadId: string | null,
  threads: ThreadSummary[],
  selectedCwd: string | null,
  selectedInputId: string | null,
  logs: TranscriptItem[]
): ThreadSnapshotRefs {
  const activeThreadIdRef = useRef(activeThreadId)
  const threadsRef = useRef(threads)
  const selectedCwdRef = useRef(selectedCwd)
  const selectedInputIdRef = useRef(selectedInputId)
  const stateLogsRef = useRef(logs)

  // Keep snapshot refs synchronized in one effect to reduce per-render effect churn.
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId
    threadsRef.current = threads
    selectedCwdRef.current = selectedCwd
    selectedInputIdRef.current = selectedInputId
    stateLogsRef.current = logs
  }, [activeThreadId, threads, selectedCwd, selectedInputId, logs])

  return {
    activeThreadIdRef,
    threadsRef,
    selectedCwdRef,
    selectedInputIdRef,
    stateLogsRef,
  }
}

/**
 * 历史记录管理 Refs
 */
export interface HistoryRefs {
  historyLoadTokenRef: React.RefObject<number>
  historyLoadSeqByThreadRef: React.RefObject<Record<string, number>>
  historyLoadingRef: React.RefObject<Record<string, boolean>>
  historyCursorByThreadIdRef: React.RefObject<Record<string, string | null>>
}

/**
 * 创建历史记录管理 Refs
 *
 * ✅ Hook 顶层调用 useRef（符合 Hooks 规则）
 */
export function useHistoryRefs(historyCursorByThreadId: Record<string, string | null>): HistoryRefs {
  const historyLoadTokenRef = useRef(0)
  const historyLoadSeqByThreadRef = useRef<Record<string, number>>({})
  const historyLoadingRef = useRef<Record<string, boolean>>({})
  const historyCursorByThreadIdRef = useRef<Record<string, string | null>>(historyCursorByThreadId)

  useEffect(() => {
    historyCursorByThreadIdRef.current = historyCursorByThreadId
  }, [historyCursorByThreadId])

  return {
    historyLoadTokenRef,
    historyLoadSeqByThreadRef,
    historyLoadingRef,
    historyCursorByThreadIdRef,
  }
}

/**
 * 线程缓存快照 Refs
 */
export interface ThreadCacheRefs {
  logsByThreadIdRef: React.RefObject<Record<string, TranscriptItem[]>>
  transcriptSourceByThreadRef: React.RefObject<Record<string, ThreadTranscriptSource>>
  latestCompactBoundaryByThreadIdRef: React.RefObject<Record<string, CompactBoundarySummary | null>>
  durableSnipByThreadIdRef: React.RefObject<Record<string, DurableSnipSummary | null>>
  latestRequestCollapseByThreadIdRef: React.RefObject<Record<string, RequestCollapseSummary | null>>
  pendingSessionMemoryRestoreByThreadIdRef: React.RefObject<Record<string, SessionMemoryRestoreSummary | null>>
}

/**
 * 创建线程缓存快照 Refs
 *
 * 封装 Refs 的同步逻辑
 */
export function useThreadCacheRefs(
  logsByThreadId: Record<string, TranscriptItem[]>,
  transcriptSourceByThreadId: Record<string, ThreadTranscriptSource>,
  latestCompactBoundaryByThreadId: Record<string, CompactBoundarySummary | null>,
  durableSnipByThreadId: Record<string, DurableSnipSummary | null>,
  latestRequestCollapseByThreadId: Record<string, RequestCollapseSummary | null>,
  pendingSessionMemoryRestoreByThreadId: Record<string, SessionMemoryRestoreSummary | null>,
): ThreadCacheRefs {
  const logsByThreadIdRef = useRef(logsByThreadId)
  const transcriptSourceByThreadRef = useRef(transcriptSourceByThreadId)
  const latestCompactBoundaryByThreadIdRef = useRef(latestCompactBoundaryByThreadId)
  const durableSnipByThreadIdRef = useRef(durableSnipByThreadId)
  const latestRequestCollapseByThreadIdRef = useRef(latestRequestCollapseByThreadId)
  const pendingSessionMemoryRestoreByThreadIdRef = useRef(pendingSessionMemoryRestoreByThreadId)

  // Keep cache refs synchronized together to avoid redundant effect scheduling.
  useEffect(() => {
    logsByThreadIdRef.current = logsByThreadId
    transcriptSourceByThreadRef.current = transcriptSourceByThreadId
    latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThreadId
    durableSnipByThreadIdRef.current = durableSnipByThreadId
    latestRequestCollapseByThreadIdRef.current = latestRequestCollapseByThreadId
    pendingSessionMemoryRestoreByThreadIdRef.current = pendingSessionMemoryRestoreByThreadId
  }, [
    logsByThreadId,
    transcriptSourceByThreadId,
    latestCompactBoundaryByThreadId,
    durableSnipByThreadId,
    latestRequestCollapseByThreadId,
    pendingSessionMemoryRestoreByThreadId,
  ])

  return {
    logsByThreadIdRef,
    transcriptSourceByThreadRef,
    latestCompactBoundaryByThreadIdRef,
    durableSnipByThreadIdRef,
    latestRequestCollapseByThreadIdRef,
    pendingSessionMemoryRestoreByThreadIdRef,
  }
}

/**
 * 运行时状态（per-thread）Refs
 */
export interface ThreadRuntimeRefs {
  replayCursorByThreadRef: React.RefObject<Record<string, number>>
  replayAnomalyCountSeenByThreadRef: React.RefObject<Record<string, number>>
  runtimeStateByThreadRef: React.RefObject<Record<string, ThreadRuntimeState>>
}

/**
 * 创建线程运行时状态 Refs
 *
 * ✅ Hook 顶层调用 useRef（符合 Hooks 规则）
 */
export function useThreadRuntimeRefs(): ThreadRuntimeRefs {
  const replayCursorByThreadRef = useRef<Record<string, number>>({})
  const replayAnomalyCountSeenByThreadRef = useRef<Record<string, number>>({})
  const runtimeStateByThreadRef = useRef<Record<string, ThreadRuntimeState>>({})

  return {
    replayCursorByThreadRef,
    replayAnomalyCountSeenByThreadRef,
    runtimeStateByThreadRef,
  }
}
