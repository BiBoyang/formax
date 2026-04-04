import type { Dispatch, SetStateAction } from 'react'
import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { UserInputManager } from '../../../../tools/runtime/userInputManager'
import { buildActiveHistoryFromSessionReplay } from '../../../../chat/context/compact'
import { applyAbortToMessages } from './abortTranscript'

type SessionWriterLike = {
  appendEvent: (name: string, data?: Record<string, unknown>) => Promise<void>
  shutdown: () => Promise<void>
}

type ResumeSessionWriterLike = SessionWriterLike & {
  appendHistorySnapshot: (history: ChatHistory) => Promise<void>
}

function trimTrailingResumeCommandRows(messages: Msg[]): Msg[] {
  if (messages.length === 0) return messages
  let end = messages.length
  while (end > 0) {
    const tail = messages[end - 1]
    if (!tail) break
    // New dismiss flow writes:
    //   user "/resume"
    //   assistant command_subline "Resume cancelled"
    // Strip this trailing pair when replaying a restored session.
    if (tail.role === 'assistant' && tail.ui?.kind === 'command_subline') {
      const isResumeCancelled = String(tail.content ?? '').trim().toLowerCase() === 'resume cancelled'
      if (isResumeCancelled) {
        const prev = messages[end - 2]
        const hasResumeUserBefore =
          prev?.role === 'user' && String(prev.content ?? '').trim().toLowerCase() === '/resume'
        if (!hasResumeUserBefore) break
        end -= 2
        continue
      }
    }
    const isResumeUser = tail.role === 'user' && String(tail.content ?? '').trim().toLowerCase() === '/resume'
    if (!isResumeUser) break
    end -= 1
    continue
  }
  if (end === messages.length) return messages
  return messages.slice(0, end)
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

export async function runNewSessionTransition(args: {
  beginNewSession: () => void
  sessionSaveEnabled: boolean
  sessionWriterRef: { current: SessionWriterLike | null }
  sessionWriterInitPromiseRef: { current: Promise<void> | null }
  lastPersistedSigByMsgIdRef: { current: Map<string, string> }
  lastPersistedMsgByIdRef: { current: Map<string, Msg> }
  resetSessionState: () => void
  replaceTranscript: (nextMessages: Msg[]) => Promise<void>
}): Promise<void> {
  args.beginNewSession()
  if (args.sessionSaveEnabled) {
    const inflightInit = args.sessionWriterInitPromiseRef.current
    if (inflightInit) {
      await inflightInit.catch(() => undefined)
    }
    args.sessionWriterInitPromiseRef.current = null
    const oldWriter = args.sessionWriterRef.current
    args.sessionWriterRef.current = null
    args.lastPersistedSigByMsgIdRef.current = new Map()
    args.lastPersistedMsgByIdRef.current = new Map()
    void (async () => {
      if (!oldWriter) return
      await oldWriter.appendEvent('clear')
      await oldWriter.shutdown()
    })()
  }
  args.resetSessionState()
  await args.replaceTranscript([])
}

export async function runResumeSessionTransition(args: {
  filePath: string
  readSessionFile: (filePath: string) => Promise<{ messages: Msg[]; history: ChatHistory }>
  beginNewSession: () => void
  sessionSaveEnabled: boolean
  sessionWriterRef: { current: ResumeSessionWriterLike | null }
  lastPersistedSigByMsgIdRef: { current: Map<string, string> }
  lastPersistedMsgByIdRef: { current: Map<string, Msg> }
  resetSessionState: () => void
  historyRef: { current: ChatHistory }
  replaceTranscript: (nextMessages: Msg[]) => Promise<void>
  openExistingSessionWriter: (filePath: string) => Promise<ResumeSessionWriterLike>
  buildPersistedSigMap: (messages: Msg[]) => Map<string, string>
  buildPersistedMsgRefMap: (messages: Msg[]) => Map<string, Msg>
}): Promise<void> {
  const replay = await args.readSessionFile(args.filePath)
  const sanitizedMessages = trimTrailingResumeCommandRows(replay.messages)
  args.beginNewSession()

  // Flush and close the current writer (if any) before switching to the resumed session file.
  if (args.sessionSaveEnabled) {
    const old = args.sessionWriterRef.current
    args.sessionWriterRef.current = null
    args.lastPersistedSigByMsgIdRef.current = new Map()
    args.lastPersistedMsgByIdRef.current = new Map()
    void (async () => {
      if (!old) return
      await old.appendEvent('resume_switch', { to: args.filePath })
      await old.shutdown()
    })()
  }

  // Reset transient runtime state, then restore persisted state.
  args.resetSessionState()
  args.historyRef.current = buildActiveHistoryFromSessionReplay(replay.history)

  await args.replaceTranscript(sanitizedMessages)
  args.lastPersistedSigByMsgIdRef.current = args.buildPersistedSigMap(sanitizedMessages)
  args.lastPersistedMsgByIdRef.current = args.buildPersistedMsgRefMap(sanitizedMessages)

  if (args.sessionSaveEnabled) {
    const writer = await args.openExistingSessionWriter(args.filePath)
    args.sessionWriterRef.current = writer
    await writer.appendEvent('resume')
    await writer.appendHistorySnapshot(args.historyRef.current)
  }
}
