import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { PromptBlock } from '../../../../prompts'
import { SessionWriter } from '../../sessionSave/writer'
import type { ReplMode } from '../../mode'
import { enqueueSessionTransition } from './transitionQueue'

export function queueSessionTransition(args: {
  sessionTransitionQueueRef: { current: Promise<void> }
  sessionTransitionPendingCountRef: { current: number }
  run: () => Promise<void>
}): Promise<void> {
  return enqueueSessionTransition(args)
}

export async function runNewSessionAction(args: {
  initialSessionFilePathRef: { current: string | undefined }
  historySnapshotBaseRef?: { current: ChatHistory | null }
  sessionTransitionQueueRef: { current: Promise<void> }
  sessionTransitionPendingCountRef: { current: number }
  runNewSessionTransition: (args: {
    beginNewSession: () => void
    sessionSaveEnabled: boolean
    sessionWriterRef: { current: SessionWriter | null }
    sessionWriterInitPromiseRef: { current: Promise<void> | null }
    lastPersistedSigByMsgIdRef: { current: Map<string, string> }
    lastPersistedMsgByIdRef: { current: Map<string, Msg> }
    resetSessionState: () => void
    replaceTranscript: (nextMessages: Msg[]) => Promise<void>
  }) => Promise<void>
  beginNewSession: () => void
  sessionSaveEnabled: boolean
  sessionWriterRef: { current: SessionWriter | null }
  sessionWriterInitPromiseRef: { current: Promise<void> | null }
  lastPersistedSigByMsgIdRef: { current: Map<string, string> }
  lastPersistedMsgByIdRef: { current: Map<string, Msg> }
  resetSessionState: () => void
  replaceTranscript: (nextMessages: Msg[]) => Promise<void>
}): Promise<void> {
  args.initialSessionFilePathRef.current = undefined
  if (args.historySnapshotBaseRef) args.historySnapshotBaseRef.current = null
  await queueSessionTransition({
    sessionTransitionQueueRef: args.sessionTransitionQueueRef,
    sessionTransitionPendingCountRef: args.sessionTransitionPendingCountRef,
    run: async () => {
      await args.runNewSessionTransition({
        beginNewSession: args.beginNewSession,
        sessionSaveEnabled: args.sessionSaveEnabled,
        sessionWriterRef: args.sessionWriterRef,
        sessionWriterInitPromiseRef: args.sessionWriterInitPromiseRef,
        lastPersistedSigByMsgIdRef: args.lastPersistedSigByMsgIdRef,
        lastPersistedMsgByIdRef: args.lastPersistedMsgByIdRef,
        resetSessionState: args.resetSessionState,
        replaceTranscript: args.replaceTranscript,
      })
    },
  })
}

export async function renameSessionAction(filePath: string, label: string): Promise<void> {
  const writer = await SessionWriter.openExisting({ filePath })
  await writer.appendEvent('session_rename', { label })
  await writer.shutdown()
}

export async function runResumeSessionAction(args: {
  filePath: string
  isLoading: boolean
  closeResumeDialog: () => void
  initialSessionFilePathRef: { current: string | undefined }
  sessionTransitionQueueRef: { current: Promise<void> }
  sessionTransitionPendingCountRef: { current: number }
  abort: () => void
  runResumeSessionTransition: (args: {
    filePath: string
    readSessionFile: (filePath: string) => Promise<{ messages: Msg[]; history: ChatHistory }>
    beginNewSession: () => void
    sessionSaveEnabled: boolean
    sessionWriterRef: { current: SessionWriter | null }
    lastPersistedSigByMsgIdRef: { current: Map<string, string> }
    lastPersistedMsgByIdRef: { current: Map<string, Msg> }
    resetSessionState: () => void
    historyRef: { current: ChatHistory }
    historySnapshotBaseRef?: { current: ChatHistory | null }
    pendingInjectedBlocksRef?: { current: PromptBlock[] }
    cwd: string
    mode: ReplMode
    planPath: string | null
    replaceTranscript: (nextMessages: Msg[]) => Promise<void>
    openExistingSessionWriter: (filePath: string) => Promise<SessionWriter>
    buildPersistedSigMap: (messages: Msg[]) => Map<string, string>
    buildPersistedMsgRefMap: (messages: Msg[]) => Map<string, Msg>
  }) => Promise<void>
  readSessionFile: (filePath: string) => Promise<{ messages: Msg[]; history: ChatHistory }>
  beginNewSession: () => void
  sessionSaveEnabled: boolean
  sessionWriterRef: { current: SessionWriter | null }
  lastPersistedSigByMsgIdRef: { current: Map<string, string> }
  lastPersistedMsgByIdRef: { current: Map<string, Msg> }
  resetSessionState: () => void
  historyRef: { current: ChatHistory }
  historySnapshotBaseRef?: { current: ChatHistory | null }
  pendingInjectedBlocksRef?: { current: PromptBlock[] }
  cwd: string
  mode: ReplMode
  planPath: string | null
  replaceTranscript: (nextMessages: Msg[]) => Promise<void>
  openExistingSessionWriter: (filePath: string) => Promise<SessionWriter>
  buildPersistedSigMap: (messages: Msg[]) => Map<string, string>
  buildPersistedMsgRefMap: (messages: Msg[]) => Map<string, Msg>
  setError: (message: string) => void
}): Promise<void> {
  if (args.isLoading) return

  args.closeResumeDialog()
  args.initialSessionFilePathRef.current = args.filePath
  try {
    await queueSessionTransition({
      sessionTransitionQueueRef: args.sessionTransitionQueueRef,
      sessionTransitionPendingCountRef: args.sessionTransitionPendingCountRef,
      run: async () => {
        args.abort()
        await args.runResumeSessionTransition({
          filePath: args.filePath,
          readSessionFile: args.readSessionFile,
          beginNewSession: args.beginNewSession,
          sessionSaveEnabled: args.sessionSaveEnabled,
          sessionWriterRef: args.sessionWriterRef,
          lastPersistedSigByMsgIdRef: args.lastPersistedSigByMsgIdRef,
          lastPersistedMsgByIdRef: args.lastPersistedMsgByIdRef,
          resetSessionState: args.resetSessionState,
          historyRef: args.historyRef,
          historySnapshotBaseRef: args.historySnapshotBaseRef,
          pendingInjectedBlocksRef: args.pendingInjectedBlocksRef,
          cwd: args.cwd,
          mode: args.mode,
          planPath: args.planPath,
          replaceTranscript: args.replaceTranscript,
          openExistingSessionWriter: args.openExistingSessionWriter,
          buildPersistedSigMap: args.buildPersistedSigMap,
          buildPersistedMsgRefMap: args.buildPersistedMsgRefMap,
        })
      },
    })
  } catch (resumeError) {
    const message = resumeError instanceof Error ? resumeError.message : String(resumeError)
    args.setError(`Failed to resume session: ${message}`)
  }
}
