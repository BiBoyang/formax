/**
 * Thread Archived Notification Handler
 *
 * 处理线程归档通知的编排逻辑：
 * 1. 解析 opId/threadId
 * 2. 查找并清理 pendingArchiveOps
 * 3. 执行 pruneThreadScopedRuntimeRefs
 * 4. 计算下一个活跃线程（resolveArchiveSelection）
 * 5. 处理 fallback 选择逻辑
 * 6. 清理 UI 状态（mode、diff、logs）
 */

import { resolveArchiveSelection, formatArchiveNotice, type ArchiveThreadLike, type ReplMode } from '../../../semantics'
import type { AppAction } from '../../../store'
import type { ThreadSummary } from '../../../types'
import type { SelectThreadOptions } from '../threadActions'

export interface ThreadArchivedHandlerDeps {
  dispatch: React.Dispatch<AppAction>
  pruneThreadScopedRuntimeRefs: (threads: Array<{ id: string }>) => void
  refreshWorkspaceDiff: (cwd: string | null) => Promise<void>
  setNoticeMessage: (message: string | null) => void
  setSelectedCwd: (cwd: string | null) => void
  selectThreadRef: React.RefObject<(threadId: string, options?: SelectThreadOptions) => void>
  setMode: (mode: ReplMode) => void
  threadsRef: React.RefObject<ThreadSummary[]> // 使用完整类型，避免 dispatch 类型不匹配
  activeThreadIdRef: React.RefObject<string | null>
  pendingArchiveOpsRef: React.RefObject<Map<string, { threadId: string; thread: ArchiveThreadLike | null }>>
}

/**
 * 创建线程归档通知处理器
 *
 * @param deps - 处理器依赖
 * @returns 通知处理函数
 */
export function createThreadArchivedHandler(deps: ThreadArchivedHandlerDeps) {
  return (params: unknown) => {
    const event = params && typeof params === 'object' ? (params as Record<string, unknown>) : null
    const threadId = typeof event?.threadId === 'string' ? event.threadId.trim() : ''
    if (!threadId) return

    const opId = typeof event?.opId === 'string' ? event.opId.trim() : ''
    if (opId) {
      const tracked = deps.pendingArchiveOpsRef.current.get(opId)
      if (tracked) {
        deps.pendingArchiveOpsRef.current.delete(opId)
        deps.pruneThreadScopedRuntimeRefs(deps.threadsRef.current)
        deps.setNoticeMessage(formatArchiveNotice(tracked.thread))
      }
    }

    const currentThreads = deps.threadsRef.current
    if (!currentThreads.some((thread) => thread.id === threadId)) return

    const nextThreads = currentThreads.filter((thread) => thread.id !== threadId)
    deps.dispatch({ type: 'set_threads', threads: nextThreads })

    if (deps.activeThreadIdRef.current !== threadId) return

    // fallback 选择逻辑
    const orderedThreadIds = [...currentThreads]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map((thread) => thread.id)

    const selection = resolveArchiveSelection({
      activeThreadId: threadId,
      archivedThreadId: threadId,
      orderedThreadIds,
    })

    if (selection.nextActiveThreadId) {
      // 使用 ref 而不是直接调用，避免陈闭包
      deps.selectThreadRef.current?.(selection.nextActiveThreadId, { restoreOnReplayFailure: false })
      return
    }

    // 没有剩余线程，清理状态
    deps.activeThreadIdRef.current = null
    deps.setMode('normal')
    deps.dispatch({ type: 'set_active_thread', threadId: null })
    deps.dispatch({ type: 'set_active_turn', turnId: null })
    deps.dispatch({ type: 'clear_pending_inputs' })
    deps.dispatch({ type: 'replace_logs', logs: [] })
    deps.setSelectedCwd(null)
    void deps.refreshWorkspaceDiff(null).catch(() => undefined)
  }
}
