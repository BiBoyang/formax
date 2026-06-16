import type { Dispatch, SetStateAction } from 'react'
import type { AppAction } from '../../store'
import type { CompactBoundarySummary, PendingInput, ResolvedInput, RpcNotification } from '../../types'
import { isNotificationForActiveThread } from '../core/appEventMachine'
import { parseCompactBoundarySummary } from '../core/compactBoundarySummary'
import { parseContextMeterBudgetRaw, parseProviderUsageRaw } from '../core/rpcContracts'
import { extractThreadIdFromNotificationParams, reduceThreadRuntimeState, type ThreadRuntimePreferences, type ThreadRuntimeState } from '../../semantics'
import type { ReplMode } from '../../semantics'
import { mapTurnNotificationToCanonicalEvents } from '../../semantics'
import type { SequencedNotificationOwner } from '../../turnEventCursor'

export type ProcessNotificationContext = {
  runtimeStateByThreadRef: { current: Record<string, ThreadRuntimeState> }
  replayCursorByThreadRef: { current: Record<string, number> }
  activeThreadIdRef: { current: string | null }
  commandByTurnRef: { current: Map<string, string> }
  createInitialThreadRuntimeState: (args: { threadId: string; replaySeq: number; method: string; ts?: unknown }) => ThreadRuntimeState
  shouldProcessSequencedNotification: (params: unknown, owner: SequencedNotificationOwner) => boolean
  dispatch: Dispatch<AppAction>
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
  onThreadRuntimePreferencesChanged?: (threadId: string, preferences: ThreadRuntimePreferences) => void
  cacheLiveCompactBoundary?: (args: { threadId: string; turnId: string; boundary: CompactBoundarySummary }) => void
  commitLiveCompactBoundary?: (args: { threadId: string; turnId: string }) => void
  clearLiveCompactBoundary?: (args: { threadId: string; turnId: string }) => void
  onThreadArchivedNotification?: (params: unknown) => void
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return value as Record<string, unknown>
}

function extractClientMessageId(params: Record<string, unknown>): string | null {
  const input = asObject(params.input)
  const clientMessageId = input.clientMessageId
  return typeof clientMessageId === 'string' && clientMessageId.trim() ? clientMessageId : null
}

export function processNotification(
  notification: RpcNotification,
  ctx: ProcessNotificationContext,
  owner: SequencedNotificationOwner = { kind: 'live-stream' },
): void {
  const params = asObject(notification.params)
  const threadId = extractThreadIdFromNotificationParams(params)
  const replaySeq = typeof params.replaySeq === 'number' && Number.isFinite(params.replaySeq) ? params.replaySeq : null

  if (!ctx.shouldProcessSequencedNotification(params, owner)) return

  if (threadId && replaySeq != null) {
    const current = ctx.runtimeStateByThreadRef.current[threadId]
    const baseState =
      current ??
      ctx.createInitialThreadRuntimeState({
        threadId,
        replaySeq,
        method: notification.method,
        ts: params.ts,
      })
    const nextState = ctx.reduceThreadRuntimeState(baseState, {
      method: notification.method,
      params,
      replaySeq,
    })
    ctx.runtimeStateByThreadRef.current[threadId] = nextState
    if (notification.method === 'thread/runtimeStateChanged') {
      ctx.onThreadRuntimePreferencesChanged?.(threadId, nextState.preferences)
    }
  } else if (threadId && notification.method === 'thread/runtimeStateChanged') {
    const current = ctx.runtimeStateByThreadRef.current[threadId]
    const baseState =
      current ??
      ctx.createInitialThreadRuntimeState({
        threadId,
        replaySeq: 0,
        method: notification.method,
        ts: params.ts,
      })
    const nextState = ctx.reduceThreadRuntimeState(baseState, {
      method: notification.method,
      params,
      replaySeq: baseState.lastReplaySeq + 1,
    })
    ctx.runtimeStateByThreadRef.current[threadId] = nextState
    ctx.onThreadRuntimePreferencesChanged?.(threadId, nextState.preferences)
  }

  if (threadId && replaySeq != null) {
    const current = ctx.replayCursorByThreadRef.current[threadId]
    ctx.replayCursorByThreadRef.current[threadId] = typeof current === 'number' ? Math.max(current, replaySeq) : replaySeq
  }

  const isActiveThread = () =>
    isNotificationForActiveThread({ params, activeThreadId: ctx.activeThreadIdRef.current })

  if (notification.method === 'turn/started' && isActiveThread()) {
    const turn = asObject(params.turn)
    const turnId = typeof turn.id === 'string' ? turn.id : ''
    const clientMessageId = extractClientMessageId(params)
    if (turnId) {
      if (clientMessageId) {
        ctx.dispatch({ type: 'bind_optimistic_user_message_turn', clientMessageId, turnId, activate: true })
      } else {
        ctx.dispatch({ type: 'bind_last_optimistic_user_message_turn', turnId, activate: true })
      }
    }
  }

  if (threadId) {
    if (notification.method === 'turn/started') {
      const contextMeter = asObject(params.contextMeter)
      if (contextMeter.budgetRaw === null) {
        ctx.dispatch({
          type: 'context_meter_budget_received',
          threadId,
          budgetRaw: null,
          ...(typeof params.ts === 'string' ? { ts: params.ts } : {}),
        })
      } else if (Object.prototype.hasOwnProperty.call(contextMeter, 'budgetRaw')) {
        const budgetRaw = parseContextMeterBudgetRaw(contextMeter.budgetRaw)
        if (budgetRaw) {
          ctx.dispatch({
            type: 'context_meter_budget_received',
            threadId,
            budgetRaw,
            ...(typeof params.ts === 'string' ? { ts: params.ts } : {}),
          })
        }
      }
    } else if (notification.method === 'turn/event') {
      const turnId = typeof params.turnId === 'string' && params.turnId.trim() ? params.turnId : ''
      const event = asObject(params.event)
      if (turnId && event.type === 'usage') {
        const usage = parseProviderUsageRaw(event.usage)
        if (usage) {
          ctx.dispatch({
            type: 'context_meter_usage_received',
            threadId,
            turnId,
            usage,
            ...(replaySeq !== null ? { replaySeq } : {}),
            ...(typeof params.ts === 'string' ? { ts: params.ts } : {}),
          })
        }
      }
    }
  }

  if (isActiveThread()) {
    const canonicalEvents = mapTurnNotificationToCanonicalEvents(
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
      const turn = asObject(params.turn)
      const turnId = typeof turn.id === 'string' ? turn.id : ''
      const nextMode = turn.mode
      if (ctx.isReplMode(nextMode)) {
        ctx.setMode(nextMode)
        ctx.cacheThreadMode(threadId ?? ctx.activeThreadIdRef.current, nextMode)
      }
      ctx.dispatch({ type: 'set_active_turn', turnId: turnId || null })
      break
    }

    case 'turn/modeChanged': {
      if (!isActiveThread()) break
      if (ctx.isReplMode(params.mode)) {
        ctx.setMode(params.mode)
        ctx.cacheThreadMode(threadId ?? ctx.activeThreadIdRef.current, params.mode)
      }
      break
    }

    case 'turn/completed': {
      const turn = asObject(params.turn)
      const turnId = typeof turn.id === 'string' ? turn.id : ''
      if (threadId && turnId) {
        ctx.commitLiveCompactBoundary?.({ threadId, turnId })
      }
      if (!isActiveThread()) {
        void ctx.refreshThreads().catch(() => undefined)
        void ctx.refreshWorkspaceDiff().catch(() => undefined)
        break
      }
      ctx.dispatch({ type: 'set_active_turn', turnId: null })
      if (turnId) {
        ctx.commandByTurnRef.current.delete(turnId)
      }
      void ctx.refreshThreads().catch(() => undefined)
      void ctx.refreshWorkspaceDiff().catch(() => undefined)
      break
    }

    case 'turn/failed': {
      const turn = asObject(params.turn)
      const turnId = typeof turn.id === 'string' ? turn.id : ''
      if (threadId && turnId) {
        ctx.clearLiveCompactBoundary?.({ threadId, turnId })
      }
      if (!isActiveThread()) {
        void ctx.refreshWorkspaceDiff().catch(() => undefined)
        break
      }
      ctx.dispatch({ type: 'set_active_turn', turnId: null })
      const command = turnId ? ctx.commandByTurnRef.current.get(turnId) : undefined
      if (command) {
        ctx.log(`Command failed: ${command}`, 'error', turnId)
        ctx.commandByTurnRef.current.delete(turnId)
      }
      ctx.log(`Turn failed: ${String(params.error ?? 'unknown')}`, 'error', turnId || undefined)
      void ctx.refreshWorkspaceDiff().catch(() => undefined)
      break
    }

    case 'turn/event': {
      if (threadId) {
        const event = asObject(params.event)
        if (event.type === 'compact_boundary') {
          const boundary = parseCompactBoundarySummary(event.boundary)
          const turnId = typeof params.turnId === 'string' ? params.turnId : ''
          if (boundary && turnId) {
            ctx.cacheLiveCompactBoundary?.({ threadId, turnId, boundary })
          }
        }
      }
      if (!isActiveThread()) break
      const turnId = typeof params.turnId === 'string' ? params.turnId : ''
      if (!turnId) break
      const event = asObject(params.event)
      const eventType = event.type

      if (eventType === 'error') {
        ctx.log(String(event.error ?? 'Stream error'), 'error', turnId)
        break
      }
      break
    }

    case 'turn/inputRequested': {
      if (!isActiveThread()) break
      const input = params.input as PendingInput | undefined
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
      const input = params.input as ResolvedInput | undefined
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

    case 'thread/updated': {
      void ctx.refreshThreads().catch(() => undefined)
      break
    }

    default:
      break
  }
}
