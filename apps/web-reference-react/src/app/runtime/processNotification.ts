import type { Dispatch, SetStateAction } from 'react'
import type { PendingInput, ResolvedInput, RpcNotification } from '../../types'
import { isNotificationForActiveThread } from '../core/appEventMachine'
import { extractThreadIdFromNotificationParams, reduceThreadRuntimeState, type ThreadRuntimeState } from '../../../../../src/features/semantics/runtime/threadRuntimeState'
import type { CanonicalEventSource } from '../../../../../src/features/semantics/core/canonicalEvents'
import type { ReplMode } from '../../../../../src/features/semantics/core/replModeTransition'

export type ProcessNotificationContext = {
  runtimeStateByThreadRef: { current: Record<string, ThreadRuntimeState> }
  replayCursorByThreadRef: { current: Record<string, number> }
  activeThreadIdRef: { current: string | null }
  commandByTurnRef: { current: Map<string, string> }
  createInitialThreadRuntimeState: (args: { threadId: string; replaySeq: number; method: string; ts?: unknown }) => ThreadRuntimeState
  shouldProcessSequencedNotification: (params: any) => boolean
  toCanonicalMeta: (args: {
    threadId: string | null | undefined
    turnId: string
    kind: string
    params?: Record<string, unknown> | null | undefined
  }) => {
    threadId: string
    replaySeq: number
    eventId: string
    ts: string
    source: CanonicalEventSource
  }
  dispatch: Dispatch<any>
  setMode: Dispatch<SetStateAction<ReplMode>>
  cacheThreadMode: (threadId: string | null | undefined, nextMode: ReplMode) => void
  isReplMode: (value: unknown) => value is ReplMode
  refreshThreads: () => Promise<void>
  refreshWorkspaceDiff: () => Promise<void>
  summarizeToolEvent: (event: any) => string
  toToolUseId: (value: unknown) => string | undefined
  toTurnFooterStatus: (errorMessage: string | null | undefined) => 'failed' | 'interrupted'
  formatToolInputAsParamsText: (input: unknown) => string | undefined
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
  if (threadId) {
    const current = ctx.runtimeStateByThreadRef.current[threadId]
    const replaySeqRaw = typeof params?.replaySeq === 'number' && Number.isFinite(params.replaySeq) ? params.replaySeq : null
    const replaySeq = replaySeqRaw ?? (current ? current.lastReplaySeq + 1 : 1)
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

  const replaySeq = typeof params?.replaySeq === 'number' && Number.isFinite(params.replaySeq) ? params.replaySeq : null
  if (threadId && replaySeq != null) {
    const current = ctx.replayCursorByThreadRef.current[threadId]
    ctx.replayCursorByThreadRef.current[threadId] = typeof current === 'number' ? Math.max(current, replaySeq) : replaySeq
  }

  if (!ctx.shouldProcessSequencedNotification(params)) return

  const isActiveThread = () =>
    isNotificationForActiveThread({ params, activeThreadId: ctx.activeThreadIdRef.current })

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
      if (turnId) {
        const eventThreadId = typeof params?.turn?.threadId === 'string' ? params.turn.threadId : ctx.activeThreadIdRef.current
        const thinkingMeta = ctx.toCanonicalMeta({ threadId: eventThreadId, turnId, kind: 'thinking_finalized', params })
        ctx.dispatch({ type: 'apply_canonical_event', event: { ...thinkingMeta, kind: 'thinking_finalized', turnId } })
        const footerMeta = ctx.toCanonicalMeta({ threadId: eventThreadId, turnId, kind: 'turn_footer', params })
        ctx.dispatch({
          type: 'apply_canonical_event',
          event: { ...footerMeta, kind: 'turn_footer', turnId, status: 'completed' },
        })
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
      if (!isActiveThread()) {
        void ctx.refreshWorkspaceDiff().catch(() => undefined)
        break
      }
      const turnId = String(params?.turn?.id ?? '')
      if (turnId) {
        const eventThreadId = typeof params?.turn?.threadId === 'string' ? params.turn.threadId : ctx.activeThreadIdRef.current
        const thinkingMeta = ctx.toCanonicalMeta({ threadId: eventThreadId, turnId, kind: 'thinking_finalized', params })
        ctx.dispatch({ type: 'apply_canonical_event', event: { ...thinkingMeta, kind: 'thinking_finalized', turnId } })
        const footerMeta = ctx.toCanonicalMeta({ threadId: eventThreadId, turnId, kind: 'turn_footer', params })
        ctx.dispatch({
          type: 'apply_canonical_event',
          event: {
            ...footerMeta,
            kind: 'turn_footer',
            turnId,
            status: ctx.toTurnFooterStatus(String(params?.error ?? '')),
            message: String(params?.error ?? 'unknown'),
          },
        })
      }
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
      const eventThreadId = typeof params?.threadId === 'string' ? params.threadId : ctx.activeThreadIdRef.current
      if (!turnId) break
      const eventType = params?.event?.type

      if (eventType === 'assistant_delta') {
        const textDelta = String(params?.event?.text ?? '')
        if (!textDelta) break
        const meta = ctx.toCanonicalMeta({ threadId: eventThreadId, turnId, kind: 'assistant_delta', params })
        ctx.dispatch({ type: 'apply_canonical_event', event: { ...meta, kind: 'assistant_delta', turnId, textDelta } })
        break
      }

      if (eventType === 'thinking_delta') {
        const text = String(params?.event?.thinking ?? params?.event?.text ?? params?.event?.delta ?? '')
        if (text) {
          const meta = ctx.toCanonicalMeta({ threadId: eventThreadId, turnId, kind: 'thinking_delta', params })
          ctx.dispatch({ type: 'apply_canonical_event', event: { ...meta, kind: 'thinking_delta', turnId, textDelta: text } })
        }
        break
      }

      if (eventType === 'tool_start' || eventType === 'tool_update' || eventType === 'tool_end') {
        const event = params?.event
        const toolUseId = ctx.toToolUseId(event?.id) ?? ctx.toToolUseId(event?.toolUseId)
        if (!toolUseId) break
        const meta = ctx.toCanonicalMeta({ threadId: eventThreadId, turnId, kind: 'tool_event', params })
        const summary = ctx.summarizeToolEvent(event)
        ctx.dispatch({
          type: 'apply_canonical_event',
          event: {
            ...meta,
            kind: 'tool_event',
            turnId,
            toolUseId,
            phase: eventType === 'tool_start' ? 'start' : eventType === 'tool_update' ? 'update' : 'end',
            ...(event?.name ? { toolName: String(event.name) } : {}),
            ...(eventType === 'tool_update' && summary ? { line: summary } : {}),
            ...(eventType === 'tool_end' && summary ? { summary } : {}),
            ...(event?.input ? { paramsText: ctx.formatToolInputAsParamsText(event.input) } : {}),
            isError: Boolean(event?.result?.is_error),
          },
        })
        break
      }

      if (eventType === 'error') {
        ctx.log(String(params?.event?.error ?? 'Stream error'), 'error', turnId)
        break
      }

      if (eventType === 'tool_input') {
        const event = params?.event
        const toolUseId = ctx.toToolUseId(event?.id) ?? ctx.toToolUseId(event?.toolUseId)
        if (!toolUseId) break
        const meta = ctx.toCanonicalMeta({ threadId: eventThreadId, turnId, kind: 'tool_event', params })
        ctx.dispatch({
          type: 'apply_canonical_event',
          event: {
            ...meta,
            kind: 'tool_event',
            turnId,
            toolUseId,
            phase: 'update',
            ...(event?.name ? { toolName: String(event.name) } : {}),
            ...(event?.input ? { paramsText: ctx.formatToolInputAsParamsText(event.input) } : {}),
          },
        })
      }
      break
    }

    case 'turn/inputRequested': {
      if (!isActiveThread()) break
      const input = params?.input as PendingInput | undefined
      if (!input?.inputId) break
      const meta = ctx.toCanonicalMeta({ threadId: input.threadId, turnId: input.turnId, kind: 'tool_input_state', params })
      ctx.dispatch({
        type: 'apply_canonical_event',
        event: {
          ...meta,
          kind: 'tool_input_state',
          turnId: input.turnId,
          toolUseId: input.toolUseId,
          ...(typeof input.payload?.toolName === 'string' ? { toolName: input.payload.toolName } : {}),
          inputKind: input.kind,
          status: 'pending',
        },
      })
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
      if (input?.turnId && input?.toolUseId && input?.kind && input?.status) {
        const meta = ctx.toCanonicalMeta({ threadId: input.threadId, turnId: input.turnId, kind: 'tool_input_state', params })
        ctx.dispatch({
          type: 'apply_canonical_event',
          event: {
            ...meta,
            kind: 'tool_input_state',
            turnId: input.turnId,
            toolUseId: input.toolUseId,
            inputKind: input.kind,
            status: input.status,
          },
        })
      }
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
