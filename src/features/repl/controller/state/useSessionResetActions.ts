import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Msg } from '../../../../shared/toolMessageTypes'
import {
  clearCanonicalTransientState as clearCanonicalTransientStateInternal,
  clearToolRuntimeState as clearToolRuntimeStateInternal,
  nextCanonicalReplaySeq as nextCanonicalReplaySeqInternal,
  nextCanonicalTurnSeq as nextCanonicalTurnSeqInternal,
  resetCanonicalProjectionState as resetCanonicalProjectionStateInternal,
  resetSessionRefs as resetSessionRefsInternal,
  resetSessionUiState as resetSessionUiStateInternal,
  resetStreamingBuffers as resetStreamingBuffersInternal,
} from './sessionReset'

type ResetStreamingBuffersArgs = Parameters<typeof resetStreamingBuffersInternal>[0]
type ClearToolRuntimeStateArgs = Parameters<typeof clearToolRuntimeStateInternal>[0]
type ClearCanonicalTransientStateArgs = Parameters<typeof clearCanonicalTransientStateInternal>[0]
type ResetSessionRefsArgs = Parameters<typeof resetSessionRefsInternal>[0]
type ResetCanonicalProjectionStateArgs = Parameters<typeof resetCanonicalProjectionStateInternal>[0]
type ResetSessionUiStateArgs = Parameters<typeof resetSessionUiStateInternal>[0]
type NextCanonicalReplaySeqArgs = Parameters<typeof nextCanonicalReplaySeqInternal>[0]
type NextCanonicalTurnSeqArgs = Parameters<typeof nextCanonicalTurnSeqInternal>[0]

function useSessionResetActions(args: {
  canonicalThreadId: string
  assistantBufferRef: ResetStreamingBuffersArgs['assistantBufferRef']
  thinkingBufferRef: ResetStreamingBuffersArgs['thinkingBufferRef']
  thinkingMessageIdRef: ResetStreamingBuffersArgs['thinkingMessageIdRef']
  thinkingLastFlushAtRef: ResetStreamingBuffersArgs['thinkingLastFlushAtRef']
  thinkingTimingRef: ResetStreamingBuffersArgs['thinkingTimingRef']
  setThinkingText: ResetStreamingBuffersArgs['setThinkingText']
  setThinkingStartedAtMs: ResetStreamingBuffersArgs['setThinkingStartedAtMs']
  toolNameByIdRef: ClearToolRuntimeStateArgs['toolNameByIdRef']
  toolInputByIdRef: ClearToolRuntimeStateArgs['toolInputByIdRef']
  taskStatsByToolUseIdRef: ClearToolRuntimeStateArgs['taskStatsByToolUseIdRef']
  taskKindByToolUseIdRef: ClearToolRuntimeStateArgs['taskKindByToolUseIdRef']
  toolMessageIdByToolUseIdRef: ClearToolRuntimeStateArgs['toolMessageIdByToolUseIdRef']
  exploreBatchRef: ClearToolRuntimeStateArgs['exploreBatchRef']
  transientSnapshotRef: ClearCanonicalTransientStateArgs['transientSnapshotRef']
  setCanonicalTurnMessages: Dispatch<SetStateAction<Msg[]>>
  setCanonicalTransientActive: Dispatch<SetStateAction<boolean>>
  deferredToolExposureSessionKeyRef: ResetSessionRefsArgs['deferredToolExposureSessionKeyRef']
  historyRef: ResetSessionRefsArgs['historyRef']
  pendingInjectedBlocksRef: ResetSessionRefsArgs['pendingInjectedBlocksRef']
  pendingExitPlanReminderRef: ResetSessionRefsArgs['pendingExitPlanReminderRef']
  currentAssistantIdRef: ResetSessionRefsArgs['currentAssistantIdRef']
  contextBudgetConfigRef: ResetSessionRefsArgs['contextBudgetConfigRef']
  sendSeqRef: ResetSessionRefsArgs['sendSeqRef']
  autoCompactSeqRef: ResetSessionRefsArgs['autoCompactSeqRef']
  claudeMdMetaSigRef: ResetSessionRefsArgs['claudeMdMetaSigRef']
  projectionRef: ResetCanonicalProjectionStateArgs['projectionRef']
  replaySeqRef: NextCanonicalReplaySeqArgs
  turnIdRef: ResetCanonicalProjectionStateArgs['turnIdRef']
  turnSeqRef: NextCanonicalTurnSeqArgs
  setError: ResetSessionUiStateArgs['setError']
  setContext: ResetSessionUiStateArgs['setContext']
}): {
  resetStreamingBuffers: () => void
  clearToolRuntimeState: () => void
  clearCanonicalTransientState: () => void
  resetSessionUiState: () => void
  resetSessionState: () => void
  nextCanonicalReplaySeq: () => number
  nextCanonicalTurnSeq: () => number
} {
  const resetStreamingBuffers = useCallback(() => {
    resetStreamingBuffersInternal({
      assistantBufferRef: args.assistantBufferRef,
      thinkingBufferRef: args.thinkingBufferRef,
      thinkingMessageIdRef: args.thinkingMessageIdRef,
      thinkingLastFlushAtRef: args.thinkingLastFlushAtRef,
      thinkingTimingRef: args.thinkingTimingRef,
      setThinkingText: args.setThinkingText,
      setThinkingStartedAtMs: args.setThinkingStartedAtMs,
    })
  }, [
    args.assistantBufferRef,
    args.setThinkingStartedAtMs,
    args.setThinkingText,
    args.thinkingBufferRef,
    args.thinkingLastFlushAtRef,
    args.thinkingMessageIdRef,
    args.thinkingTimingRef,
  ])

  const clearToolRuntimeState = useCallback(() => {
    clearToolRuntimeStateInternal({
      toolNameByIdRef: args.toolNameByIdRef,
      toolInputByIdRef: args.toolInputByIdRef,
      taskStatsByToolUseIdRef: args.taskStatsByToolUseIdRef,
      taskKindByToolUseIdRef: args.taskKindByToolUseIdRef,
      toolMessageIdByToolUseIdRef: args.toolMessageIdByToolUseIdRef,
      exploreBatchRef: args.exploreBatchRef,
    })
  }, [
    args.exploreBatchRef,
    args.taskKindByToolUseIdRef,
    args.taskStatsByToolUseIdRef,
    args.toolInputByIdRef,
    args.toolMessageIdByToolUseIdRef,
    args.toolNameByIdRef,
  ])

  const clearCanonicalTransientState = useCallback(() => {
    clearCanonicalTransientStateInternal({
      transientSnapshotRef: args.transientSnapshotRef,
      setCanonicalTurnMessages: args.setCanonicalTurnMessages as ClearCanonicalTransientStateArgs['setCanonicalTurnMessages'],
      setCanonicalTransientActive: args.setCanonicalTransientActive,
    })
  }, [args.setCanonicalTransientActive, args.setCanonicalTurnMessages, args.transientSnapshotRef])

  const resetSessionRefs = useCallback(() => {
    resetSessionRefsInternal({
      deferredToolExposureSessionKeyRef: args.deferredToolExposureSessionKeyRef,
      historyRef: args.historyRef,
      pendingInjectedBlocksRef: args.pendingInjectedBlocksRef,
      pendingExitPlanReminderRef: args.pendingExitPlanReminderRef,
      currentAssistantIdRef: args.currentAssistantIdRef,
      contextBudgetConfigRef: args.contextBudgetConfigRef,
      sendSeqRef: args.sendSeqRef,
      autoCompactSeqRef: args.autoCompactSeqRef,
      clearToolRuntimeState,
      claudeMdMetaSigRef: args.claudeMdMetaSigRef,
    })
  }, [
    args.autoCompactSeqRef,
    args.claudeMdMetaSigRef,
    args.contextBudgetConfigRef,
    args.currentAssistantIdRef,
    args.deferredToolExposureSessionKeyRef,
    args.historyRef,
    args.pendingExitPlanReminderRef,
    args.pendingInjectedBlocksRef,
    args.sendSeqRef,
    clearToolRuntimeState,
  ])

  const resetCanonicalProjectionState = useCallback(() => {
    resetCanonicalProjectionStateInternal({
      canonicalThreadId: args.canonicalThreadId,
      projectionRef: args.projectionRef,
      replaySeqRef: args.replaySeqRef,
      turnIdRef: args.turnIdRef,
      turnSeqRef: args.turnSeqRef,
      clearCanonicalTransientState,
    })
  }, [
    args.canonicalThreadId,
    args.projectionRef,
    args.replaySeqRef,
    args.turnIdRef,
    args.turnSeqRef,
    clearCanonicalTransientState,
  ])

  const resetSessionUiState = useCallback(() => {
    resetSessionUiStateInternal({
      resetStreamingBuffers,
      setError: args.setError,
      setContext: args.setContext,
    })
  }, [args.setContext, args.setError, resetStreamingBuffers])

  const resetSessionState = useCallback(() => {
    resetSessionRefs()
    resetCanonicalProjectionState()
    resetSessionUiState()
  }, [resetCanonicalProjectionState, resetSessionRefs, resetSessionUiState])

  const nextCanonicalReplaySeq = useCallback(() => {
    return nextCanonicalReplaySeqInternal(args.replaySeqRef)
  }, [args.replaySeqRef])

  const nextCanonicalTurnSeq = useCallback(() => {
    return nextCanonicalTurnSeqInternal(args.turnSeqRef)
  }, [args.turnSeqRef])

  return {
    resetStreamingBuffers,
    clearToolRuntimeState,
    clearCanonicalTransientState,
    resetSessionUiState,
    resetSessionState,
    nextCanonicalReplaySeq,
    nextCanonicalTurnSeq,
  }
}

export {
  useSessionResetActions,
}
