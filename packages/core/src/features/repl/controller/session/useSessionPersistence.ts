import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { ReplMode } from '../../mode'
import type { SessionWriter } from '../../sessionSave/writer'
import {
  buildMessageByIdMap,
  markDirtyMessageIdsFromTransition,
} from './sessionDirtyTracking'
import {
  persistDirtyStableMessages,
} from './sessionLifecycle'
import {
  runSessionTurnCompletionSideEffects,
} from './sessionTurnCompletion'

function useSessionPersistence(args: {
  sessionSaveEnabled: boolean
  initialSessionFilePath?: string
  ensureSessionWriter: () => Promise<void>
  messages: Msg[]
  previousMessagesRef: MutableRefObject<Msg[]>
  messageByIdRef: MutableRefObject<Map<string, Msg>>
  dirtyMessageIdsRef: MutableRefObject<Set<string>>
  sessionWriterRef: MutableRefObject<SessionWriter | null>
  lastPersistedSigByMsgIdRef: MutableRefObject<Map<string, string>>
  lastPersistedMsgByIdRef: MutableRefObject<Map<string, Msg>>
  isLoading: boolean
  previousIsLoadingRef: MutableRefObject<boolean>
  historyRef: MutableRefObject<ChatHistory>
  engine: ChatEngine
  cwd: string
  mode: ReplMode
  getPlanPath: () => string | null
  attemptedSessionIds: Set<string>
  checkedTopicPromptKeys: Set<string>
  model: string
}): void {
  useEffect(() => {
    if (!args.sessionSaveEnabled) return
    if (!args.initialSessionFilePath) return
    void args.ensureSessionWriter()
  }, [args.ensureSessionWriter, args.initialSessionFilePath, args.sessionSaveEnabled])

  useEffect(() => {
    if (!args.sessionSaveEnabled) {
      args.previousMessagesRef.current = args.messages
      args.messageByIdRef.current = buildMessageByIdMap(args.messages)
      args.dirtyMessageIdsRef.current.clear()
      return
    }
    markDirtyMessageIdsFromTransition({
      previous: args.previousMessagesRef.current,
      next: args.messages,
      messageByIdRef: args.messageByIdRef,
      dirtyMessageIdsRef: args.dirtyMessageIdsRef,
    })
    args.previousMessagesRef.current = args.messages
  }, [args.dirtyMessageIdsRef, args.messageByIdRef, args.messages, args.previousMessagesRef, args.sessionSaveEnabled])

  useEffect(() => {
    if (!args.sessionSaveEnabled) {
      args.dirtyMessageIdsRef.current.clear()
      return
    }
    persistDirtyStableMessages({
      writer: args.sessionWriterRef.current,
      dirtyMessageIdsRef: args.dirtyMessageIdsRef,
      messageByIdRef: args.messageByIdRef,
      lastPersistedSigByMsgIdRef: args.lastPersistedSigByMsgIdRef,
      lastPersistedMsgByIdRef: args.lastPersistedMsgByIdRef,
    })
  }, [
    args.dirtyMessageIdsRef,
    args.lastPersistedMsgByIdRef,
    args.lastPersistedSigByMsgIdRef,
    args.messageByIdRef,
    args.messages,
    args.sessionSaveEnabled,
    args.sessionWriterRef,
  ])

  useEffect(() => {
    const writer = args.sessionWriterRef.current
    const wasLoading = args.previousIsLoadingRef.current
    args.previousIsLoadingRef.current = args.isLoading
    runSessionTurnCompletionSideEffects({
      writer,
      wasLoading,
      isLoading: args.isLoading,
      history: args.historyRef.current,
      messages: args.messages,
      engine: args.engine,
      cwd: args.cwd,
      mode: args.mode,
      planPath: args.getPlanPath(),
      attemptedSessionIds: args.attemptedSessionIds,
      checkedTopicPromptKeys: args.checkedTopicPromptKeys,
      model: args.model,
    })
  }, [
    args.checkedTopicPromptKeys,
    args.cwd,
    args.engine,
    args.historyRef,
    args.isLoading,
    args.messages,
    args.mode,
    args.model,
    args.previousIsLoadingRef,
    args.sessionWriterRef,
    args.getPlanPath,
    args.attemptedSessionIds,
  ])
}

export {
  useSessionPersistence,
}
