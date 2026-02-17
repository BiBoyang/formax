import type { Dispatch, SetStateAction } from 'react'
import type { Msg } from '../../../../components/tool/ToolMessage'
import type { UserInputManager } from '../../../../tools/runtime/userInputManager'
import { applyAbortToMessages } from './abortTranscript'

type SessionWriterLike = {
  appendEvent: (name: string, data?: Record<string, unknown>) => Promise<void>
  shutdown: () => Promise<void>
}

export function runAbortSessionTransition(args: {
  isLoading: boolean
  abortControllerRef: { current: AbortController | null }
  bashModeInFlightRef: { current: boolean }
  toolNameByIdRef: { current: Map<string, string> }
  userInput: UserInputManager | null | undefined
  resetSessionUiState: () => void
  clearCanonicalTransientState: () => void
  clearToolRuntimeState: () => void
  currentAssistantIdRef: { current: string | null }
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
}): void {
  const trackedRunningToolsSnapshot = Array.from(args.toolNameByIdRef.current.entries())
  const hadInFlightRequest = Boolean(args.abortControllerRef.current) || args.isLoading
  args.abortControllerRef.current?.abort()
  args.abortControllerRef.current = null
  args.bashModeInFlightRef.current = false

  args.userInput?.clearBufferedAnswers()
  args.userInput?.rejectAllPending(new Error('Request aborted'))

  args.resetSessionUiState()
  args.clearCanonicalTransientState()
  args.setIsLoading(false)
  args.clearToolRuntimeState()

  if (args.currentAssistantIdRef.current) {
    const id = args.currentAssistantIdRef.current
    args.setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)))
    args.currentAssistantIdRef.current = null
  }

  args.setMessages((prev) => {
    return applyAbortToMessages({
      messages: prev,
      trackedRunningTools: trackedRunningToolsSnapshot,
      hadInFlightRequest,
    })
  })
}

export function runNewSessionTransition(args: {
  beginNewSession: () => void
  sessionSaveEnabled: boolean
  sessionWriterRef: { current: SessionWriterLike | null }
  lastPersistedSigByMsgIdRef: { current: Map<string, string> }
  resetSessionState: () => void
  setTranscriptSeq: Dispatch<SetStateAction<number>>
  setMessages: Dispatch<SetStateAction<Msg[]>>
  onClearTerminal?: () => void | Promise<void>
  startNewSessionWriter: () => Promise<void>
  sessionWriterInitPromiseRef: { current: Promise<void> | null }
}): void {
  args.beginNewSession()
  if (args.sessionSaveEnabled) {
    const oldWriter = args.sessionWriterRef.current
    args.sessionWriterRef.current = null
    args.lastPersistedSigByMsgIdRef.current = new Map()
    void (async () => {
      if (!oldWriter) return
      await oldWriter.appendEvent('clear')
      await oldWriter.shutdown()
    })()
  }
  args.resetSessionState()

  // Ink <Static> is append-only; when clearing messages we must force a remount
  // so the new transcript starts from a fresh render surface.
  args.setTranscriptSeq((n) => n + 1)
  args.setMessages(() => [])
  // Clear the terminal *after* scheduling state resets, otherwise Ink may
  // re-render the old transcript once before the clear takes effect.
  void args.onClearTerminal?.()

  if (args.sessionSaveEnabled) {
    // Coordinate writer initialization with ensureSessionWriter() so a fast
    // subsequent send() can't create a second, orphaned session writer.
    const promise = args.startNewSessionWriter().finally(() => {
      if (args.sessionWriterInitPromiseRef.current === promise) args.sessionWriterInitPromiseRef.current = null
    })
    args.sessionWriterInitPromiseRef.current = promise
    void promise
  }
}
