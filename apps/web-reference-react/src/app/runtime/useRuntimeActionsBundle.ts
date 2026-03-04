import { useEffect, useMemo } from 'react'
import type { ArchiveThreadLike } from '../../semantics'
import type { PendingInput, TranscriptItem } from '../../types'
import { createComposerActions, type ComposerActionsContext } from './composerActions'
import {
  createThreadActions,
  type SelectThreadOptions,
  type ThreadActionsContext,
} from './threadActions'
import type { ThreadListItem } from './orchestrator/threadTransactions'

type CoreDeps = {
  request: ThreadActionsContext['request']
  dispatch: ThreadActionsContext['dispatch']
  log: ThreadActionsContext['log']
}

type ThreadDeps = {
  selectedCwdRef: { current: string | null }
  setSelectedCwd: ThreadActionsContext['setSelectedCwd']
  activeThreadIdRef: ThreadActionsContext['activeThreadIdRef']
  activeTurnIdRef: { current: string | null }
  selectedInputIdRef: { current: string | null }
  pendingInputsRef: { current: Record<string, PendingInput> }
  stateLogsRef: { current: TranscriptItem[] }
  threadsRef: { current: ThreadListItem[] }
  sortedThreadsRef: { current: ThreadListItem[] }
  logsByThreadIdRef: { current: Record<string, TranscriptItem[]> }
  runtimeStateByThreadRef: ThreadActionsContext['runtimeStateByThreadRef']
  replayCursorByThreadRef: ThreadActionsContext['replayCursorByThreadRef']
  setMode: ThreadActionsContext['setMode']
  setIsThreadActionBusy: ThreadActionsContext['setIsThreadActionBusy']
  replayThreadEvents: ThreadActionsContext['replayThreadEvents']
  resumeThreadInputs: ThreadActionsContext['resumeThreadInputs']
  refreshThreads: ThreadActionsContext['refreshThreads']
  refreshWorkspaceDiff: ThreadActionsContext['refreshWorkspaceDiff']
  pendingArchiveOpsRef: { current: Map<string, { threadId: string; thread: ArchiveThreadLike | null }> }
  pruneThreadScopedRuntimeRefs: (threads: Array<{ id: string }>) => void
  loadEarlierHistoryAction: ThreadActionsContext['loadEarlierHistoryAction']
  selectThreadRef: { current: (threadId: string, options?: SelectThreadOptions) => void }
}

type ComposerDeps = {
  inputText: ComposerActionsContext['inputText']
  setInputText: ComposerActionsContext['setInputText']
  isSendingTurn: ComposerActionsContext['isSendingTurn']
  isInterruptingTurn: ComposerActionsContext['isInterruptingTurn']
  isSubmittingInput: ComposerActionsContext['isSubmittingInput']
  mode: ComposerActionsContext['mode']
  activeThreadId: ComposerActionsContext['activeThreadId']
  activeTurnId: ComposerActionsContext['activeTurnId']
  commandByTurnRef: ComposerActionsContext['commandByTurnRef']
  setIsSendingTurn: ComposerActionsContext['setIsSendingTurn']
  setIsInterruptingTurn: ComposerActionsContext['setIsInterruptingTurn']
  setIsSubmittingInput: ComposerActionsContext['setIsSubmittingInput']
  setSubmitStatusByInputId: ComposerActionsContext['setSubmitStatusByInputId']
  toRpcError: ComposerActionsContext['toRpcError']
  nowMs: ComposerActionsContext['nowMs']
}

type UseRuntimeActionsBundleArgs = {
  core: CoreDeps
  thread: ThreadDeps
  composer: ComposerDeps
}

export function useRuntimeActionsBundle(args: UseRuntimeActionsBundleArgs) {
  const { core, thread, composer } = args

  const threadActionsState = useMemo(
    () => ({
      get activeThreadId() {
        return thread.activeThreadIdRef.current
      },
      get activeTurnId() {
        return thread.activeTurnIdRef.current
      },
      get selectedInputId() {
        return thread.selectedInputIdRef.current
      },
      get pendingInputs() {
        return thread.pendingInputsRef.current
      },
      get logs() {
        return thread.stateLogsRef.current
      },
      get threads() {
        return thread.threadsRef.current
      },
    }),
    [
      thread.activeThreadIdRef,
      thread.activeTurnIdRef,
      thread.pendingInputsRef,
      thread.selectedInputIdRef,
      thread.stateLogsRef,
      thread.threadsRef,
    ],
  )

  const {
    startThread,
    startThreadInCwd,
    selectThread,
    selectCwd,
    renameThread,
    archiveThread,
    loadEarlierHistory,
  } = useMemo(
    () =>
      createThreadActions({
        get selectedCwd() {
          return thread.selectedCwdRef.current
        },
        setSelectedCwd: thread.setSelectedCwd,
        state: threadActionsState,
        get sortedThreads() {
          return thread.sortedThreadsRef.current
        },
        get logsByThreadId() {
          return thread.logsByThreadIdRef.current
        },
        request: core.request,
        dispatch: core.dispatch,
        log: core.log,
        setMode: thread.setMode,
        runtimeStateByThreadRef: thread.runtimeStateByThreadRef,
        replayCursorByThreadRef: thread.replayCursorByThreadRef,
        activeThreadIdRef: thread.activeThreadIdRef,
        setIsThreadActionBusy: thread.setIsThreadActionBusy,
        replayThreadEvents: thread.replayThreadEvents,
        resumeThreadInputs: thread.resumeThreadInputs,
        refreshThreads: thread.refreshThreads,
        refreshWorkspaceDiff: thread.refreshWorkspaceDiff,
        trackArchiveOp: ({ opId, threadId, thread: archivedThread }) => {
          thread.pendingArchiveOpsRef.current.set(opId, { threadId, thread: archivedThread ?? null })
          thread.pruneThreadScopedRuntimeRefs(thread.threadsRef.current)
        },
        clearArchiveOp: (opId) => {
          return thread.pendingArchiveOpsRef.current.delete(opId)
        },
        loadEarlierHistoryAction: thread.loadEarlierHistoryAction,
      }),
    [
      core.dispatch,
      core.log,
      core.request,
      threadActionsState,
      thread.activeThreadIdRef,
      thread.loadEarlierHistoryAction,
      thread.logsByThreadIdRef,
      thread.pendingArchiveOpsRef,
      thread.pruneThreadScopedRuntimeRefs,
      thread.refreshThreads,
      thread.refreshWorkspaceDiff,
      thread.replayCursorByThreadRef,
      thread.replayThreadEvents,
      thread.resumeThreadInputs,
      thread.runtimeStateByThreadRef,
      thread.selectedCwdRef,
      thread.setIsThreadActionBusy,
      thread.setMode,
      thread.setSelectedCwd,
      thread.sortedThreadsRef,
      thread.threadsRef,
    ],
  )

  useEffect(() => {
    thread.selectThreadRef.current = selectThread
  }, [thread.selectThreadRef, selectThread])

  const { interruptTurn, submitInputById, onSend } = useMemo(
    () =>
      createComposerActions({
        inputText: composer.inputText,
        setInputText: composer.setInputText,
        isSendingTurn: composer.isSendingTurn,
        isInterruptingTurn: composer.isInterruptingTurn,
        isSubmittingInput: composer.isSubmittingInput,
        mode: composer.mode,
        activeThreadId: composer.activeThreadId,
        activeTurnId: composer.activeTurnId,
        resolveRequestCwd: (threadId) => {
          const activeThread = thread.threadsRef.current.find((threadItem) => threadItem.id === threadId)
          return thread.selectedCwdRef.current ?? activeThread?.cwd ?? null
        },
        getPendingInputById: (inputId) => thread.pendingInputsRef.current[inputId],
        request: core.request,
        dispatch: core.dispatch,
        log: core.log,
        commandByTurnRef: composer.commandByTurnRef,
        setIsSendingTurn: composer.setIsSendingTurn,
        setIsInterruptingTurn: composer.setIsInterruptingTurn,
        setIsSubmittingInput: composer.setIsSubmittingInput,
        setSubmitStatusByInputId: composer.setSubmitStatusByInputId,
        toRpcError: composer.toRpcError,
        nowMs: composer.nowMs,
        startThread,
      }),
    [
      core.dispatch,
      core.log,
      core.request,
      composer.activeThreadId,
      composer.activeTurnId,
      composer.commandByTurnRef,
      composer.inputText,
      composer.isInterruptingTurn,
      composer.isSendingTurn,
      composer.isSubmittingInput,
      composer.mode,
      composer.nowMs,
      composer.setInputText,
      composer.setIsInterruptingTurn,
      composer.setIsSendingTurn,
      composer.setIsSubmittingInput,
      composer.setSubmitStatusByInputId,
      composer.toRpcError,
      startThread,
      thread.pendingInputsRef,
      thread.selectedCwdRef,
      thread.threadsRef,
    ],
  )

  return {
    startThread,
    startThreadInCwd,
    selectThread,
    selectCwd,
    renameThread,
    archiveThread,
    loadEarlierHistory,
    interruptTurn,
    submitInputById,
    onSend,
  }
}
