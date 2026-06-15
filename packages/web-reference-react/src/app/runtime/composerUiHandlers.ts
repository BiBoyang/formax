import type { FormEvent } from 'react'
import type { ReplMode } from '../../semantics'

type ComposerUiHandlersArgs = {
  setMode: (mode: ReplMode) => void
  cacheThreadMode: (threadId: string | null, mode: ReplMode) => void
  activeThreadIdRef: { current: string | null }
  onSend: (event: FormEvent) => void
  interruptTurn: () => Promise<void>
  cancelInputById: (inputId: string) => Promise<void>
  loadEarlierHistory: () => Promise<void>
  submitInputById: (inputId: string, answers: Record<string, string>) => Promise<void>
  requestDevLoadAll: () => void
  runAsyncSafely: (task: Promise<unknown>) => void
}

export function createComposerUiHandlers(args: ComposerUiHandlersArgs) {
  return {
    onModeChange: (nextMode: ReplMode) => {
      args.setMode(nextMode)
      args.cacheThreadMode(args.activeThreadIdRef.current, nextMode)
    },
    onSend: args.onSend,
    onInterrupt: () => {
      args.runAsyncSafely(args.interruptTurn())
    },
    onCancelInput: (inputId: string) => {
      args.runAsyncSafely(args.cancelInputById(inputId))
    },
    onLoadEarlier: () => {
      args.runAsyncSafely(args.loadEarlierHistory())
    },
    onSubmitInput: (inputId: string, answers: Record<string, string>) => {
      args.runAsyncSafely(args.submitInputById(inputId, answers))
    },
    onDevLoadAllEarlier: () => {
      args.requestDevLoadAll()
    },
  }
}
