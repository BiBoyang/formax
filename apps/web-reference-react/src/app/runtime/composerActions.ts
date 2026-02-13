import type { FormEvent } from 'react'
import { resolveCommandRouting } from '../../../../../src/features/semantics/commandRouting'
import { isWebSupportedCommand } from '../core/commandSupport'
import { toSubmitUiStatus } from '../core/threadTransforms'

export type ComposerActionsContext = {
  inputText: string
  setInputText: (value: string) => void
  isSendingTurn: boolean
  isInterruptingTurn: boolean
  isSubmittingInput: boolean
  mode: 'normal' | 'plan' | 'acceptEdits'
  selectedCwd: string | null
  state: {
    activeThreadId: string | null
    activeTurnId: string | null
    threads: Array<{ id: string; cwd?: string }>
    pendingInputs: Record<string, any>
  }
  request: (method: string, params?: unknown) => Promise<any>
  dispatch: (action: any) => void
  log: (text: string, level?: 'info' | 'warn' | 'error', turnId?: string) => void
  commandByTurnRef: { current: Map<string, string> }
  setIsSendingTurn: (value: boolean) => void
  setIsInterruptingTurn: (value: boolean) => void
  setIsSubmittingInput: (value: boolean) => void
  setSubmitStatusByInputId: (updater: (prev: Record<string, { status: string; kind: 'success' | 'error'; message?: string }>) => Record<string, { status: string; kind: 'success' | 'error'; message?: string }>) => void
  toRpcError: (method: string, error: unknown) => { code?: number; message: string }
  nowMs: () => number
  startThread: () => Promise<void>
}

export function createComposerActions(ctx: ComposerActionsContext) {
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

    if (commandRouting.isExactClear) {
      ctx.setInputText('')
      if (commandRouting.commandArgs) {
        ctx.dispatch({ type: 'push_message', role: 'assistant', text: 'Usage: /clear' })
        return
      }
      await ctx.startThread()
      return
    }

    if (!ctx.state.activeThreadId) {
      ctx.log('Please select or create a thread first', 'warn')
      return
    }

    const shouldDispatchCommand = commandRouting.shouldUseCommandDispatch
    const activeThread = ctx.state.threads.find((thread) => thread.id === ctx.state.activeThreadId)
    const requestCwd = ctx.selectedCwd ?? activeThread?.cwd
    ctx.dispatch({ type: 'push_message', role: 'user', text })
    ctx.setInputText('')
    if (shouldDispatchCommand) {
      ctx.log(`Command queued: ${text}`, 'info')
    }

    ctx.setIsSendingTurn(true)
    try {
      const result = shouldDispatchCommand
        ? await ctx.request('command/dispatch', {
            threadId: ctx.state.activeThreadId,
            command: text,
            mode: ctx.mode,
            ...(requestCwd ? { cwd: requestCwd } : {}),
          })
        : await ctx.request('turn/start', {
            threadId: ctx.state.activeThreadId,
            input: { text },
            mode: ctx.mode,
            ...(requestCwd ? { cwd: requestCwd } : {}),
          })
      const localStdout =
        typeof (result as { local?: { stdout?: unknown } } | null)?.local?.stdout === 'string'
          ? ((result as { local?: { stdout?: string } }).local?.stdout ?? '')
          : ''
      if (localStdout) {
        ctx.dispatch({ type: 'push_message', role: 'assistant', text: localStdout })
        return
      }
      const turnId = String((result as any)?.turn?.id ?? '')
      if (turnId) {
        ctx.dispatch({ type: 'set_active_turn', turnId })
        ctx.dispatch({ type: 'bind_last_user_message_turn', turnId })
        if (shouldDispatchCommand) {
          ctx.commandByTurnRef.current.set(turnId, text)
        }
      }
    } finally {
      ctx.setIsSendingTurn(false)
    }
  }

  const interruptTurn = async () => {
    if (!ctx.state.activeThreadId || !ctx.state.activeTurnId || ctx.isInterruptingTurn) return
    ctx.setIsInterruptingTurn(true)
    try {
      await ctx.request('turn/interrupt', {
        threadId: ctx.state.activeThreadId,
        turnId: ctx.state.activeTurnId,
      })
      ctx.log(`Interrupt requested: ${ctx.state.activeTurnId}`, 'warn', ctx.state.activeTurnId)
    } finally {
      ctx.setIsInterruptingTurn(false)
    }
  }

  const submitInputById = async (inputId: string, answers: Record<string, string>) => {
    const input = ctx.state.pendingInputs[inputId]
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
      const status = String((response as { status?: string })?.status ?? 'unknown')
      const uiStatus = toSubmitUiStatus(status)
      ctx.setSubmitStatusByInputId((prev) => ({
        ...prev,
        [input.inputId]: {
          status,
          kind: uiStatus.kind,
          message: uiStatus.message,
        },
      }))
      ctx.log(`Input submit: ${status}`, uiStatus.kind === 'error' ? 'error' : 'info', input.turnId)
    } catch (error) {
      const details = ctx.toRpcError('turn/input/submit', error)
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
