import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { resolveCommandRouting } from '../../semantics'
import { isWebSupportedCommand } from '../core/commandSupport'
import { parseInputSubmitResponse, parseTurnStartLikeResponse } from '../core/rpcContracts'
import { toSubmitUiStatus, type RpcErrorDetails } from '../core/threadTransforms'
import type { PendingInput, TranscriptItem } from '../../types'
import type { AppAction } from '../../store'
import type { CreatedThreadResult } from './threadActions'
import type { NewThreadDraftState } from './newThreadDraft'
import { normalizeDraftCwd } from './newThreadDraft'
import {
  commitPendingTurnDraftAction,
  createPendingTurnDraft,
  pushPendingTurnDraftActions,
  rollbackPendingTurnDraftActions,
  type PendingTurnDraft,
} from './pendingTurnDraft'

export type ComposerActionsContext = {
  inputText: string
  setInputText: Dispatch<SetStateAction<string>>
  isSendingTurn: boolean
  isInterruptingTurn: boolean
  isSubmittingInput: boolean
  mode: 'normal' | 'plan' | 'acceptEdits'
  activeThreadId: string | null
  activeTurnId: string | null
  newThreadDraft: NewThreadDraftState
  resolveRequestCwd: (threadId: string) => string | null
  getPendingInputById: (inputId: string) => PendingInput | undefined
  request: (method: string, params?: unknown) => Promise<unknown>
  dispatch: (action: AppAction) => void
  log: (text: string, level?: 'info' | 'warn' | 'error', turnId?: string) => void
  commandByTurnRef: { current: Map<string, string> }
  setIsSendingTurn: (value: boolean) => void
  setIsInterruptingTurn: (value: boolean) => void
  setIsSubmittingInput: (value: boolean) => void
  setSubmitStatusByInputId: (updater: (prev: Record<string, { status: string; kind: 'success' | 'error'; message?: string }>) => Record<string, { status: string; kind: 'success' | 'error'; message?: string }>) => void
  toRpcError: (method: string, error: unknown) => RpcErrorDetails
  nowMs: () => number
  startThread: () => Promise<void>
  createThreadOnServerInCwd: (cwd: string) => Promise<CreatedThreadResult | null>
  activateCreatedThread: (
    created: CreatedThreadResult,
    options?: { synchronize?: boolean; modeOverride?: 'normal' | 'plan' | 'acceptEdits'; fallbackLogs?: TranscriptItem[] },
  ) => Promise<void>
  leaveNewThreadDraft: () => void
  refreshThreads: () => Promise<void>
  refreshWorkspaceDiff: (cwdOverride?: string | null) => Promise<void>
  awaitPreferencePersistence?: () => Promise<void>
  persistDraftRuntimePreferences?: (threadId: string) => Promise<void>
  getCurrentActiveThreadId: () => string | null
  getCurrentNewThreadDraft: () => NewThreadDraftState
  retirePendingInputLocally: (args: {
    input: PendingInput
    status?: 'expired' | 'canceled' | 'failed'
    reason?: string
  }) => void
}

export function createComposerActions(ctx: ComposerActionsContext) {
  let startTurnInFlight = false
  let submittedMessageSeq = 0

  const dispatchAll = (actions: AppAction[]) => {
    for (const action of actions) {
      ctx.dispatch(action)
    }
  }

  const resolveRpcErrorKind = (data: unknown): string | null => {
    if (!data || typeof data !== 'object') return null
    const kind = (data as { kind?: unknown }).kind
    return typeof kind === 'string' && kind.trim().length > 0 ? kind : null
  }

  const resolveLocalRetire = (
    status: string,
  ): { status: 'expired' | 'canceled' | 'failed'; reason?: string } | null => {
    switch (status) {
      case 'expired':
        return { status: 'expired', reason: 'input_expired' }
      case 'canceled':
        return { status: 'canceled', reason: 'turn_interrupted' }
      default:
        return null
    }
  }

  const startTurn = async () => {
    const text = ctx.inputText.trim()
    if (
      !text ||
      ctx.isSendingTurn ||
      startTurnInFlight
    ) {
      return
    }
    startTurnInFlight = true

    const commandRouting = resolveCommandRouting(text)
    if (
      commandRouting.isSlashCommandAfterTrim &&
      commandRouting.commandName &&
      !isWebSupportedCommand(commandRouting.commandName)
    ) {
      ctx.setInputText('')
      ctx.dispatch({
        type: 'push_message',
        role: 'assistant',
        text: `Web reference does not support ${commandRouting.commandName} yet. Please use TUI for this command.`,
      })
      startTurnInFlight = false
      return
    }

    const activeDraft = ctx.newThreadDraft.status === 'active' ? ctx.newThreadDraft : null
    const draftActive = activeDraft != null
    const draftCwd = activeDraft ? normalizeDraftCwd(activeDraft.cwd) : null
    const draftToken = activeDraft ? { source: activeDraft.source, cwd: draftCwd } : null

    if (commandRouting.isExactClear) {
      ctx.setInputText('')
      if (commandRouting.commandArgs) {
        ctx.dispatch({ type: 'push_message', role: 'assistant', text: 'Usage: /clear' })
        startTurnInFlight = false
        return
      }
      if (draftActive) {
        startTurnInFlight = false
        return
      }
      try {
        await ctx.startThread()
      } finally {
        startTurnInFlight = false
      }
      return
    }

    if (!ctx.activeThreadId && !draftActive) {
      ctx.log('Please select or create a thread first', 'warn')
      startTurnInFlight = false
      return
    }

    if (draftActive && !draftCwd) {
      ctx.log('Please choose a project before starting a new thread', 'warn')
      startTurnInFlight = false
      return
    }

    const shouldDispatchCommand = commandRouting.shouldUseCommandDispatch
    let requestThreadId = ctx.activeThreadId
    let requestCwd = requestThreadId ? ctx.resolveRequestCwd(requestThreadId) : draftCwd
    const clientMessageId = `client-message-${ctx.nowMs()}-${submittedMessageSeq += 1}`
    const pendingTurnDraft: PendingTurnDraft | null = shouldDispatchCommand
      ? null
      : createPendingTurnDraft({
          text,
          clientMessageId,
          messageId: `optimistic-user-${ctx.nowMs()}`,
        })
    const pushOptimisticUserMessage = () => {
      if (!pendingTurnDraft) return
      dispatchAll(pushPendingTurnDraftActions(pendingTurnDraft, { activate: Boolean(requestThreadId) }))
    }
    ctx.setIsSendingTurn(true)
    let draftCreatedThread: CreatedThreadResult | null = null
    const refreshDraftCreatedThread = () => {
      if (!draftCreatedThread) return
      void ctx.refreshThreads().catch(() => undefined)
      void ctx.refreshWorkspaceDiff(draftCreatedThread.effectiveCwd ?? requestCwd ?? null).catch(() => undefined)
    }
    try {
      await ctx.awaitPreferencePersistence?.()
      ctx.setInputText('')
      if (shouldDispatchCommand) {
        ctx.log(`Command queued: ${text}`, 'info')
      }

      pushOptimisticUserMessage()

      if (!requestThreadId && draftCwd) {
        const created = await ctx.createThreadOnServerInCwd(draftCwd)
        if (!created) {
          ctx.log('Failed to create thread for draft first send', 'error')
          throw new Error('thread/start returned no thread payload')
        }
        const currentDraft = ctx.getCurrentNewThreadDraft()
        const draftSendStillActive =
          draftToken != null &&
          currentDraft.status === 'active' &&
          currentDraft.source === draftToken.source &&
          normalizeDraftCwd(currentDraft.cwd) === draftToken.cwd &&
          ctx.getCurrentActiveThreadId() == null
        if (!draftSendStillActive) {
          if (pendingTurnDraft) {
            dispatchAll(rollbackPendingTurnDraftActions(pendingTurnDraft))
          }
          void ctx.refreshThreads().catch(() => undefined)
          return
        }
        await ctx.activateCreatedThread(created, {
          synchronize: false,
          modeOverride: ctx.mode,
          ...(pendingTurnDraft ? { fallbackLogs: [pendingTurnDraft.message] } : {}),
        })
        if (pendingTurnDraft) {
          ctx.dispatch({ type: 'set_active_turn', turnId: pendingTurnDraft.pendingTurnId })
        }
        ctx.leaveNewThreadDraft()
        draftCreatedThread = created
        requestThreadId = created.thread.id
        requestCwd = created.effectiveCwd ?? draftCwd
        await ctx.persistDraftRuntimePreferences?.(requestThreadId)
      }

      if (!requestThreadId) {
        ctx.log('Please select or create a thread first', 'warn')
        return
      }

      const result = shouldDispatchCommand
        ? await ctx.request('command/dispatch', {
            threadId: requestThreadId,
            command: text,
            mode: ctx.mode,
            ...(requestCwd ? { cwd: requestCwd } : {}),
          })
        : await ctx.request('turn/start', {
            threadId: requestThreadId,
            input: { text, clientMessageId },
            mode: ctx.mode,
            ...(requestCwd ? { cwd: requestCwd } : {}),
          })
      const parsedTurnResult = parseTurnStartLikeResponse(result)
      const localStdout = parsedTurnResult.localStdout
      if (localStdout) {
        refreshDraftCreatedThread()
        ctx.dispatch({ type: 'push_message', role: 'user', text })
        ctx.dispatch({ type: 'push_message', role: 'assistant', text: localStdout })
        return
      }
      refreshDraftCreatedThread()
      const turnId = parsedTurnResult.turnId ?? ''
      if (turnId) {
        if (pendingTurnDraft) {
          ctx.dispatch(commitPendingTurnDraftAction(pendingTurnDraft, turnId))
        } else {
          ctx.dispatch({ type: 'set_active_turn', turnId })
        }
        if (shouldDispatchCommand) {
          ctx.commandByTurnRef.current.set(turnId, text)
        }
      }
    } catch (error) {
      if (requestThreadId && draftCreatedThread) {
        void ctx.refreshThreads().catch(() => undefined)
        void ctx.refreshWorkspaceDiff(draftCreatedThread.effectiveCwd ?? requestCwd ?? null).catch(() => undefined)
      }
      ctx.setInputText((current) => (current.trim() ? current : text))
      if (pendingTurnDraft) {
        dispatchAll(rollbackPendingTurnDraftActions(pendingTurnDraft))
      }
      throw error
    } finally {
      ctx.setIsSendingTurn(false)
      startTurnInFlight = false
    }
  }

  const interruptTurn = async () => {
    if (!ctx.activeThreadId || !ctx.activeTurnId || ctx.isInterruptingTurn) return
    ctx.setIsInterruptingTurn(true)
    try {
      await ctx.request('turn/interrupt', {
        threadId: ctx.activeThreadId,
        turnId: ctx.activeTurnId,
      })
      ctx.log(`Interrupt requested: ${ctx.activeTurnId}`, 'warn', ctx.activeTurnId)
    } finally {
      ctx.setIsInterruptingTurn(false)
    }
  }

  const cancelInputById = async (inputId: string) => {
    const input = ctx.getPendingInputById(inputId)
    if (!input || ctx.isInterruptingTurn) return
    ctx.setIsInterruptingTurn(true)
    try {
      await ctx.request('turn/interrupt', {
        threadId: input.threadId,
        turnId: input.turnId,
      })
      ctx.log(`Input cancel requested: ${input.inputId}`, 'warn', input.turnId)
    } finally {
      ctx.setIsInterruptingTurn(false)
    }
  }

  const submitInputById = async (inputId: string, answers: Record<string, string>) => {
    const input = ctx.getPendingInputById(inputId)
    if (!input || ctx.isSubmittingInput) return

    ctx.setIsSubmittingInput(true)
    try {
      const response = await ctx.request('turn/input/submit', {
        threadId: input.threadId,
        turnId: input.turnId,
        inputId: input.inputId,
        toolUseId: input.toolUseId,
        answers,
        submissionId: `web-${ctx.nowMs()}`,
      })
      const { status } = parseInputSubmitResponse(response)
      const uiStatus = toSubmitUiStatus(status)
      ctx.setSubmitStatusByInputId((prev) => ({
        ...prev,
        [input.inputId]: {
          status,
          kind: uiStatus.kind,
          message: uiStatus.message,
        },
      }))
      const localRetire = resolveLocalRetire(status)
      if (localRetire) {
        ctx.retirePendingInputLocally({
          input,
          ...localRetire,
        })
      } else if (status === 'not_pending') {
        ctx.retirePendingInputLocally({
          input,
          reason: 'input_not_pending',
        })
      }
      ctx.log(`Input submit: ${status}`, uiStatus.kind === 'error' ? 'error' : 'info', input.turnId)
    } catch (error) {
      const details = ctx.toRpcError('turn/input/submit', error)
      const errorKind = resolveRpcErrorKind(details.data)
      if (errorKind === 'INPUT_EXPIRED') {
        const uiStatus = toSubmitUiStatus('expired')
        ctx.setSubmitStatusByInputId((prev) => ({
          ...prev,
          [input.inputId]: {
            status: 'expired',
            kind: uiStatus.kind,
            message: uiStatus.message,
          },
        }))
        const localRetire = resolveLocalRetire('expired')
        if (localRetire) {
          ctx.retirePendingInputLocally({ input, ...localRetire })
        }
        return
      }
      ctx.setSubmitStatusByInputId((prev) => ({
        ...prev,
        [input.inputId]: {
          status: details.code != null ? `rpc_${details.code}` : 'error',
          kind: 'error',
          message: details.message,
        },
      }))
      throw error
    } finally {
      ctx.setIsSubmittingInput(false)
    }
  }

  const onSend = (event: FormEvent) => {
    event.preventDefault()
    void startTurn().catch(() => undefined)
  }

  return {
    startTurn,
    interruptTurn,
    cancelInputById,
    submitInputById,
    onSend,
  }
}
