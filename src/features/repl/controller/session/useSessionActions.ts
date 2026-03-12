import { useCallback } from 'react'
import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { SessionWriter } from '../../sessionSave/writer'
import {
  renameSessionAction,
  runNewSessionAction,
  runResumeSessionAction,
} from './sessionActions'

function useSessionActions(args: {
  engine: ChatEngine
  isLoading: boolean
  closeResumeDialog: () => void
  sessionSaveEnabled: boolean
  initialSessionFilePathRef: { current: string | undefined }
  sessionTransitionQueueRef: { current: Promise<void> }
  sessionTransitionPendingCountRef: { current: number }
  sessionWriterRef: { current: SessionWriter | null }
  sessionWriterInitPromiseRef: { current: Promise<void> | null }
  lastPersistedSigByMsgIdRef: { current: Map<string, string> }
  lastPersistedMsgByIdRef: { current: Map<string, Msg> }
  resetSessionState: () => void
  replaceTranscript: (nextMessages: Msg[]) => Promise<void>
  historyRef: { current: ChatHistory }
  abort: () => void
  setError: (message: string) => void
  runNewSessionTransition: Parameters<typeof runNewSessionAction>[0]['runNewSessionTransition']
  runResumeSessionTransition: Parameters<typeof runResumeSessionAction>[0]['runResumeSessionTransition']
  readSessionFile: Parameters<typeof runResumeSessionAction>[0]['readSessionFile']
  openExistingSessionWriter: Parameters<typeof runResumeSessionAction>[0]['openExistingSessionWriter']
  buildPersistedSigMap: Parameters<typeof runResumeSessionAction>[0]['buildPersistedSigMap']
  buildPersistedMsgRefMap: Parameters<typeof runResumeSessionAction>[0]['buildPersistedMsgRefMap']
}): {
  runNewSession: () => Promise<void>
  newSession: () => void
  resumeSession: (filePath: string) => Promise<void>
  renameSession: (filePath: string, label: string) => Promise<void>
} {
  const runNewSession = useCallback(async (): Promise<void> => {
    await runNewSessionAction({
      initialSessionFilePathRef: args.initialSessionFilePathRef,
      sessionTransitionQueueRef: args.sessionTransitionQueueRef,
      sessionTransitionPendingCountRef: args.sessionTransitionPendingCountRef,
      runNewSessionTransition: args.runNewSessionTransition,
      beginNewSession: () => args.engine.beginNewSession?.({ source: 'clear' }),
      sessionSaveEnabled: args.sessionSaveEnabled,
      sessionWriterRef: args.sessionWriterRef,
      sessionWriterInitPromiseRef: args.sessionWriterInitPromiseRef,
      lastPersistedSigByMsgIdRef: args.lastPersistedSigByMsgIdRef,
      lastPersistedMsgByIdRef: args.lastPersistedMsgByIdRef,
      resetSessionState: args.resetSessionState,
      replaceTranscript: args.replaceTranscript,
    })
  }, [
    args.engine,
    args.initialSessionFilePathRef,
    args.lastPersistedMsgByIdRef,
    args.lastPersistedSigByMsgIdRef,
    args.replaceTranscript,
    args.runNewSessionTransition,
    args.resetSessionState,
    args.sessionSaveEnabled,
    args.sessionTransitionPendingCountRef,
    args.sessionTransitionQueueRef,
    args.sessionWriterInitPromiseRef,
    args.sessionWriterRef,
  ])

  const newSession = useCallback(() => {
    void runNewSession()
  }, [runNewSession])

  const renameSession = useCallback(async (filePath: string, label: string): Promise<void> => {
    await renameSessionAction(filePath, label)
  }, [])

  const resumeSession = useCallback(
    async (filePath: string): Promise<void> => {
      await runResumeSessionAction({
        filePath,
        isLoading: args.isLoading,
        closeResumeDialog: args.closeResumeDialog,
        initialSessionFilePathRef: args.initialSessionFilePathRef,
        sessionTransitionQueueRef: args.sessionTransitionQueueRef,
        sessionTransitionPendingCountRef: args.sessionTransitionPendingCountRef,
        abort: args.abort,
        runResumeSessionTransition: args.runResumeSessionTransition,
        readSessionFile: args.readSessionFile,
        beginNewSession: () => args.engine.beginNewSession?.({ source: 'resume' }),
        sessionSaveEnabled: args.sessionSaveEnabled,
        sessionWriterRef: args.sessionWriterRef,
        lastPersistedSigByMsgIdRef: args.lastPersistedSigByMsgIdRef,
        lastPersistedMsgByIdRef: args.lastPersistedMsgByIdRef,
        resetSessionState: args.resetSessionState,
        historyRef: args.historyRef,
        replaceTranscript: args.replaceTranscript,
        openExistingSessionWriter: args.openExistingSessionWriter,
        buildPersistedSigMap: args.buildPersistedSigMap,
        buildPersistedMsgRefMap: args.buildPersistedMsgRefMap,
        setError: args.setError,
      })
    },
    [
      args.abort,
      args.closeResumeDialog,
      args.engine,
      args.historyRef,
      args.initialSessionFilePathRef,
      args.isLoading,
      args.lastPersistedMsgByIdRef,
      args.lastPersistedSigByMsgIdRef,
      args.openExistingSessionWriter,
      args.replaceTranscript,
      args.runResumeSessionTransition,
      args.resetSessionState,
      args.sessionSaveEnabled,
      args.sessionTransitionPendingCountRef,
      args.sessionTransitionQueueRef,
      args.sessionWriterRef,
      args.readSessionFile,
      args.buildPersistedSigMap,
      args.buildPersistedMsgRefMap,
      args.setError,
    ],
  )

  return {
    runNewSession,
    newSession,
    resumeSession,
    renameSession,
  }
}

export {
  useSessionActions,
}
