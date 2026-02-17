import type { Dispatch, SetStateAction } from 'react'
import type { PendingInput, ResolvedInput, RpcNotification } from '../../types'
import { isNotificationForActiveThread } from '../core/appEventMachine'
import { extractThreadIdFromNotificationParams, reduceThreadRuntimeState, type ThreadRuntimeState } from '../../../../../src/features/semantics/runtime/threadRuntimeState'
import type { ReplMode } from '../../../../../src/features/semantics/core/replModeTransition'
import { toCanonicalEventsFromTurnNotification } from '../../../../../src/features/semantics/adapters/turnNotificationCanonicalAdapter'

export type ProcessNotificationContext = {
  runtimeStateByThreadRef: { current: Record<string, ThreadRuntimeState> }
  replayCursorByThreadRef: { current: Record<string, number> }
  activeThreadIdRef: { current: string | null }
  commandByTurnRef: { current: Map<string, string> }
  createInitialThreadRuntimeState: (args: { threadId: string; replaySeq: number; method: string; ts?: unknown }) => ThreadRuntimeState
  shouldProcessSequencedNotification: (params: any) => boolean
  dispatch: Dispatch<any>
  setMode: Dispatch<SetStateAction<ReplMode>>
  cacheThreadMode: (threadId: string | null | undefined, nextMode: ReplMode) => void
  isReplMode: (value: unknown) => value is ReplMode
  refreshThreads: () => Promise<void>
  refreshWorkspaceDiff: () => Promise<void>
  log: (text: string, level?: 'info' | 'warn' | 'error', turnId?: string) => void
  setAskDockOpenByInputId: Dispatch<SetStateAction<Record<string, boolean>>>
  setAskPageIndexByInputId: Dispatch<SetStateAction<Record<string, number>>>
  setAskDraftByInputId: Dispatch<SetStateAction<Record<string, Record<string, string>>>>
  setSubmitStatusByInputId: Dispatch<SetStateAction<Record<string, { status: string; kind: 'success' | 'error'; message?: string }>>>
  reduceThreadRuntimeState: typeof reduceThreadRuntimeState
  onThreadArchivedNotification?: (params: unknown) => void
}

export function processNotification(notification: RpcNotification, ctx: ProcessNotificationContext): void {
  const params = (notification.params ?? {}) as any
  const threadId = extractThreadIdFromNotificationParams(params)
  const replaySeq = typeof params?.replaySeq === 'number' && Number.isFinite(params.replaySeq) ? params.replaySeq : null
  if (threadId && replaySeq != null) {
    const current = ctx.runtimeStateByThreadRef.current[threadId]
    const baseState =
      current ??
      ctx.createInitialThreadRuntimeState({
        threadId,
        replaySeq,
        method: notification.method,
        ts: params?.ts,
      })
    ctx.runtimeStateByThreadRef.current[threadId] = ctx.reduceThreadRuntimeState(baseState, {
      method: notification.method,
      params,
      replaySeq,
    })
  }

  if (threadId && replaySeq != null) {
    const current = ctx.replayCursorByThreadRef.current[threadId]
    ctx.replayCursorByThreadRef.current[threadId] = typeof current === 'number' ? Math.max(current, replaySeq) : replaySeq
  }

  if (!ctx.shouldProcessSequencedNotification(params)) return

  const isActiveThread = () =>
    isNotificationForActiveThread({ params, activeThreadId: ctx.activeThreadIdRef.current })

  if (isActiveThread()) {
    const canonicalEvents = toCanonicalEventsFromTurnNotification(
      { method: notification.method, params },
      {
        fallbackThreadId: threadId ?? '__missing_thread__',
        requireEnvelope: true,
        onInvalidEnvelope(issue) {
          const messageParts: string[] = []
          if (issue.missing.length > 0) {
            messageParts.push(`missing envelope fields (${issue.missing.join(', ')})`)
          }
          if (issue.invalid && issue.invalid.length > 0) {
            messageParts.push(`invalid envelope fields (${issue.invalid.join(', ')})`)
          }
          ctx.log(
            `Skipped canonical projection for ${issue.method}: ${messageParts.join('; ')}`,
            'warn',
          )
        },
      },
    )
    for (const event of canonicalEvents) {
      ctx.dispatch({ type: 'apply_canonical_event', event })
    }
  }

  switch (notification.method) {
    case 'turn/started': {
      if (!isActiveThread()) break
      const turnId = String(params?.turn?.id ?? '')
      const nextMode = params?.turn?.mode
      if (ctx.isReplMode(nextMode)) {
        ctx.setMode(nextMode)
        ctx.cacheThreadMode(threadId ?? ctx.activeThreadIdRef.current, nextMode)
      }
      ctx.dispatch({ type: 'set_active_turn', turnId: turnId || null })
      break
    }

    case 'turn/modeChanged': {
      if (!isActiveThread()) break
      if (ctx.isReplMode(params?.mode)) {
        ctx.setMode(params.mode)
        ctx.cacheThreadMode(threadId ?? ctx.activeThreadIdRef.current, params.mode)
      }
      break
    }

    case 'turn/completed': {
      if (!isActiveThread()) {
        void ctx.refreshThreads().catch(() => undefined)
        void ctx.refreshWorkspaceDiff().catch(() => undefined)
        break
      }
      const turnId = String(params?.turn?.id ?? '')
      ctx.dispatch({ type: 'set_active_turn', turnId: null })
      if (turnId) {
        ctx.commandByTurnRef.current.delete(turnId)
      }
      void ctx.refreshThreads().catch(() => undefined)
      void ctx.refreshWorkspaceDiff().catch(() => undefined)
      break
    }

    case 'turn/failed': {
      if (!isActiveThread()) {
        void ctx.refreshWorkspaceDiff().catch(() => undefined)
        break
      }
      const turnId = String(params?.turn?.id ?? '')
      ctx.dispatch({ type: 'set_active_turn', turnId: null })
      const command = turnId ? ctx.commandByTurnRef.current.get(turnId) : undefined
      if (command) {
        ctx.log(`Command failed: ${command}`, 'error', turnId)
        ctx.commandByTurnRef.current.delete(turnId)
      }
      ctx.log(`Turn failed: ${String(params?.error ?? 'unknown')}`, 'error', turnId || undefined)
      void ctx.refreshWorkspaceDiff().catch(() => undefined)
      break
    }

    case 'turn/event': {
      if (!isActiveThread()) break
      const turnId = String(params?.turnId ?? '')
      if (!turnId) break
      const eventType = params?.event?.type

      if (eventType === 'error') {
        ctx.log(String(params?.event?.error ?? 'Stream error'), 'error', turnId)
        break
      }
      break
    }

    case 'turn/inputRequested': {
      if (!isActiveThread()) break
      const input = params?.input as PendingInput | undefined
      if (!input?.inputId) break
      ctx.dispatch({ type: 'input_requested', input })
      ctx.dispatch({ type: 'set_selected_input', inputId: input.inputId })
      if (input.kind === 'ask_user_question') {
        ctx.setAskDockOpenByInputId((prev) => ({ ...prev, [input.inputId]: true }))
        ctx.setAskPageIndexByInputId((prev) => ({ ...prev, [input.inputId]: prev[input.inputId] ?? 0 }))
      }
      break
    }

    case 'turn/inputResolved': {
      if (!isActiveThread()) break
      const input = params?.input as ResolvedInput | undefined
      const inputId = input?.inputId as string | undefined
      if (!inputId) break
      ctx.setAskDockOpenByInputId((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, inputId)) return prev
        const next = { ...prev }
        delete next[inputId]
        return next
      })
      ctx.setAskDraftByInputId((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, inputId)) return prev
        const next = { ...prev }
        delete next[inputId]
        return next
      })
      ctx.setAskPageIndexByInputId((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, inputId)) return prev
        const next = { ...prev }
        delete next[inputId]
        return next
      })
      ctx.dispatch({
        type: 'input_resolved',
        inputId,
        status: String(input?.status ?? 'unknown'),
        resolvedAt: typeof input?.resolvedAt === 'string' ? input.resolvedAt : undefined,
        reason: typeof input?.reason === 'string' ? input.reason : undefined,
      })
      if (input?.status && input.status !== 'submitted') {
        ctx.setSubmitStatusByInputId((prev) => ({
          ...prev,
          [inputId]: {
            status: input.status,
            kind: input.status === 'failed' ? 'error' : 'success',
            message: input.reason,
          },
        }))
      }
      break
    }

    case 'thread/archived': {
      ctx.onThreadArchivedNotification?.(params)
      break
    }

    default:
      break
  }
}
