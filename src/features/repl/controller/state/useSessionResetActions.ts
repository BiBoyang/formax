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

type SessionResetRefs = {
  deferredToolExposureSessionKeyRef: ResetSessionRefsArgs['deferredToolExposureSessionKeyRef']
  historyRef: ResetSessionRefsArgs['historyRef']
  currentAssistantIdRef: ResetSessionRefsArgs['currentAssistantIdRef']
  assistantBufferRef: ResetStreamingBuffersArgs['assistantBufferRef']
}

type ThinkingResetRefs = {
  bufferRef: ResetStreamingBuffersArgs['thinkingBufferRef']
  messageIdRef: ResetStreamingBuffersArgs['thinkingMessageIdRef']
  lastFlushAtRef: ResetStreamingBuffersArgs['thinkingLastFlushAtRef']
  timingRef: ResetStreamingBuffersArgs['thinkingTimingRef']
}

type ToolRuntimeResetRefs = {
  nameByIdRef: ClearToolRuntimeStateArgs['toolNameByIdRef']
  inputByIdRef: ClearToolRuntimeStateArgs['toolInputByIdRef']
  statsByToolUseIdRef: ClearToolRuntimeStateArgs['taskStatsByToolUseIdRef']
  kindByToolUseIdRef: ClearToolRuntimeStateArgs['taskKindByToolUseIdRef']
  messageIdByToolUseIdRef: ClearToolRuntimeStateArgs['toolMessageIdByToolUseIdRef']
  exploreBatchRef: ClearToolRuntimeStateArgs['exploreBatchRef']
}

type CanonicalResetRefs = {
  projectionRef: ResetCanonicalProjectionStateArgs['projectionRef']
  replaySeqRef: NextCanonicalReplaySeqArgs
  turnIdRef: ResetCanonicalProjectionStateArgs['turnIdRef']
  turnSeqRef: NextCanonicalTurnSeqArgs
  transientSnapshotRef: ClearCanonicalTransientStateArgs['transientSnapshotRef']
}

type TurnFlowResetRefs = {
  pendingInjectedBlocksRef: ResetSessionRefsArgs['pendingInjectedBlocksRef']
  pendingExitPlanReminderRef: ResetSessionRefsArgs['pendingExitPlanReminderRef']
  contextBudgetConfigRef: ResetSessionRefsArgs['contextBudgetConfigRef']
}

type RuntimeStateResetRefs = {
  sendSeqRef: ResetSessionRefsArgs['sendSeqRef']
  autoCompactSeqRef: ResetSessionRefsArgs['autoCompactSeqRef']
  claudeMdMetaSigRef: ResetSessionRefsArgs['claudeMdMetaSigRef']
}

function useSessionResetActions(args: {
  canonicalThreadId: string
  sessionRefs: SessionResetRefs
  thinkingRefs: ThinkingResetRefs
  toolRuntimeRefs: ToolRuntimeResetRefs
  canonicalRefs: CanonicalResetRefs
  turnFlowRefs: TurnFlowResetRefs
  runtimeStateRefs: RuntimeStateResetRefs
  setters: {
    setThinkingText: ResetStreamingBuffersArgs['setThinkingText']
    setThinkingStartedAtMs: ResetStreamingBuffersArgs['setThinkingStartedAtMs']
    setCanonicalTurnMessages: Dispatch<SetStateAction<Msg[]>>
    setCanonicalTransientActive: Dispatch<SetStateAction<boolean>>
    setError: ResetSessionUiStateArgs['setError']
    setContext: ResetSessionUiStateArgs['setContext']
  }
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
      assistantBufferRef: args.sessionRefs.assistantBufferRef,
      thinkingBufferRef: args.thinkingRefs.bufferRef,
      thinkingMessageIdRef: args.thinkingRefs.messageIdRef,
      thinkingLastFlushAtRef: args.thinkingRefs.lastFlushAtRef,
      thinkingTimingRef: args.thinkingRefs.timingRef,
      setThinkingText: args.setters.setThinkingText,
      setThinkingStartedAtMs: args.setters.setThinkingStartedAtMs,
    })
  }, [args.sessionRefs.assistantBufferRef, args.setters.setThinkingStartedAtMs, args.setters.setThinkingText, args.thinkingRefs.bufferRef, args.thinkingRefs.lastFlushAtRef, args.thinkingRefs.messageIdRef, args.thinkingRefs.timingRef])

  const clearToolRuntimeState = useCallback(() => {
    clearToolRuntimeStateInternal({
      toolNameByIdRef: args.toolRuntimeRefs.nameByIdRef,
      toolInputByIdRef: args.toolRuntimeRefs.inputByIdRef,
      taskStatsByToolUseIdRef: args.toolRuntimeRefs.statsByToolUseIdRef,
      taskKindByToolUseIdRef: args.toolRuntimeRefs.kindByToolUseIdRef,
      toolMessageIdByToolUseIdRef: args.toolRuntimeRefs.messageIdByToolUseIdRef,
      exploreBatchRef: args.toolRuntimeRefs.exploreBatchRef,
    })
  }, [args.toolRuntimeRefs.exploreBatchRef, args.toolRuntimeRefs.inputByIdRef, args.toolRuntimeRefs.kindByToolUseIdRef, args.toolRuntimeRefs.messageIdByToolUseIdRef, args.toolRuntimeRefs.nameByIdRef, args.toolRuntimeRefs.statsByToolUseIdRef])

  const clearCanonicalTransientState = useCallback(() => {
    clearCanonicalTransientStateInternal({
      transientSnapshotRef: args.canonicalRefs.transientSnapshotRef,
      setCanonicalTurnMessages: args.setters.setCanonicalTurnMessages as ClearCanonicalTransientStateArgs['setCanonicalTurnMessages'],
      setCanonicalTransientActive: args.setters.setCanonicalTransientActive,
    })
  }, [args.canonicalRefs.transientSnapshotRef, args.setters.setCanonicalTransientActive, args.setters.setCanonicalTurnMessages])

  const resetSessionRefs = useCallback(() => {
    resetSessionRefsInternal({
      deferredToolExposureSessionKeyRef: args.sessionRefs.deferredToolExposureSessionKeyRef,
      historyRef: args.sessionRefs.historyRef,
      pendingInjectedBlocksRef: args.turnFlowRefs.pendingInjectedBlocksRef,
      pendingExitPlanReminderRef: args.turnFlowRefs.pendingExitPlanReminderRef,
      currentAssistantIdRef: args.sessionRefs.currentAssistantIdRef,
      contextBudgetConfigRef: args.turnFlowRefs.contextBudgetConfigRef,
      sendSeqRef: args.runtimeStateRefs.sendSeqRef,
      autoCompactSeqRef: args.runtimeStateRefs.autoCompactSeqRef,
      clearToolRuntimeState,
      claudeMdMetaSigRef: args.runtimeStateRefs.claudeMdMetaSigRef,
    })
  }, [args.runtimeStateRefs.autoCompactSeqRef, args.runtimeStateRefs.claudeMdMetaSigRef, args.runtimeStateRefs.sendSeqRef, args.sessionRefs.currentAssistantIdRef, args.sessionRefs.deferredToolExposureSessionKeyRef, args.sessionRefs.historyRef, args.turnFlowRefs.contextBudgetConfigRef, args.turnFlowRefs.pendingExitPlanReminderRef, args.turnFlowRefs.pendingInjectedBlocksRef, clearToolRuntimeState])

  const resetCanonicalProjectionState = useCallback(() => {
    resetCanonicalProjectionStateInternal({
      canonicalThreadId: args.canonicalThreadId,
      projectionRef: args.canonicalRefs.projectionRef,
      replaySeqRef: args.canonicalRefs.replaySeqRef,
      turnIdRef: args.canonicalRefs.turnIdRef,
      turnSeqRef: args.canonicalRefs.turnSeqRef,
      clearCanonicalTransientState,
    })
  }, [args.canonicalRefs.projectionRef, args.canonicalRefs.replaySeqRef, args.canonicalRefs.turnIdRef, args.canonicalRefs.turnSeqRef, args.canonicalThreadId, clearCanonicalTransientState])

  const resetSessionUiState = useCallback(() => {
    resetSessionUiStateInternal({
      resetStreamingBuffers,
      setError: args.setters.setError,
      setContext: args.setters.setContext,
    })
  }, [args.setters.setContext, args.setters.setError, resetStreamingBuffers])

  const resetSessionState = useCallback(() => {
    resetSessionRefs()
    resetCanonicalProjectionState()
    resetSessionUiState()
  }, [resetCanonicalProjectionState, resetSessionRefs, resetSessionUiState])

  const nextCanonicalReplaySeq = useCallback(() => {
    return nextCanonicalReplaySeqInternal(args.canonicalRefs.replaySeqRef)
  }, [args.canonicalRefs.replaySeqRef])

  const nextCanonicalTurnSeq = useCallback(() => {
    return nextCanonicalTurnSeqInternal(args.canonicalRefs.turnSeqRef)
  }, [args.canonicalRefs.turnSeqRef])

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
