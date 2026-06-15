import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { resolveCommandRouting } from '../../semantics'
import { isWebSupportedCommand } from '../core/commandSupport'
import { parseInputSubmitResponse, parseTurnStartLikeResponse } from '../core/rpcContracts'
import { toSubmitUiStatus, type RpcErrorDetails } from '../core/threadTransforms'
import type { PendingInput } from '../../types'
import type { AppAction } from '../../store'
import type { CreatedThreadResult } from './threadActions'
import type { NewThreadDraftState } from './newThreadDraft'
import { normalizeDraftCwd } from './newThreadDraft'

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
    options?: { synchronize?: boolean; modeOverride?: 'normal' | 'plan' | 'acceptEdits' },
  ) => Promise<void>
  leaveNewThreadDraft: () => void
  refreshThreads: () => Promise<void>
  refreshWorkspaceDiff: (cwdOverride?: string | null) => Promise<void>
  awaitPreferencePersistence?: () => Promise<void>
  getCurrentActiveThreadId: () => string | null
  getCurrentNewThreadDraft: () => NewThreadDraftState
  retirePendingInputLocally: (args: {
    input: PendingInput
    status?: 'expired' | 'canceled' | 'failed'
    reason?: string
  }) => void
}

export function createComposerActions(ctx: ComposerActionsContext) {
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
    if (!text || ctx.isSendingTurn) return

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
        return
      }
      if (draftActive) {
        return
      }
      await ctx.startThread()
      return
    }

    if (!ctx.activeThreadId && !draftActive) {
      ctx.log('Please select or create a thread first', 'warn')
      return
    }

    if (draftActive && !draftCwd) {
      ctx.log('Please choose a project before starting a new thread', 'warn')
      return
    }

    const shouldDispatchCommand = commandRouting.shouldUseCommandDispatch
    let requestThreadId = ctx.activeThreadId
    let requestCwd = requestThreadId ? ctx.resolveRequestCwd(requestThreadId) : draftCwd
    let optimisticUserMessageId: string | null = null
    const pushOptimisticUserMessage = () => {
      if (shouldDispatchCommand || optimisticUserMessageId) return
      optimisticUserMessageId = `optimistic-user-${ctx.nowMs()}`
      ctx.dispatch({
        type: 'push_message',
        id: optimisticUserMessageId,
        role: 'user',
        text,
        optimistic: true,
      })
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
          void ctx.refreshThreads().catch(() => undefined)
          return
        }
        await ctx.activateCreatedThread(created, { synchronize: false, modeOverride: ctx.mode })
        ctx.leaveNewThreadDraft()
        draftCreatedThread = created
        requestThreadId = created.thread.id
        requestCwd = created.effectiveCwd ?? draftCwd
      }

      if (!requestThreadId) {
        ctx.log('Please select or create a thread first', 'warn')
        return
      }

      pushOptimisticUserMessage()
      const result = shouldDispatchCommand
        ? await ctx.request('command/dispatch', {
            threadId: requestThreadId,
            command: text,
            mode: ctx.mode,
            ...(requestCwd ? { cwd: requestCwd } : {}),
          })
        : await ctx.request('turn/start', {
            threadId: requestThreadId,
            input: { text },
            mode: ctx.mode,
            ...(requestCwd ? { cwd: requestCwd } : {}),
          })
      const parsedTurnResult = parseTurnStartLikeResponse(result)
      const localStdout = parsedTurnResult.localStdout
      if (localStdout) {
        refreshDraftCreatedThread()
        if (!optimisticUserMessageId) {
          ctx.dispatch({ type: 'push_message', role: 'user', text })
        }
        ctx.dispatch({ type: 'push_message', role: 'assistant', text: localStdout })
        return
      }
      refreshDraftCreatedThread()
      const turnId = parsedTurnResult.turnId ?? ''
      if (turnId) {
        if (optimisticUserMessageId) {
          ctx.dispatch({ type: 'bind_last_optimistic_user_message_turn', turnId })
        }
        ctx.dispatch({ type: 'set_active_turn', turnId })
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
      if (optimisticUserMessageId) {
        ctx.dispatch({ type: 'remove_transcript_item', id: optimisticUserMessageId })
      }
      throw error
    } finally {
      ctx.setIsSendingTurn(false)
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
    submitInputById,
    onSend,
  }
}
