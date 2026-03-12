import { randomUUID } from 'node:crypto'
import type { Dispatch, SetStateAction } from 'react'
import { createInitialTranscriptProjectionState } from '../../../semantics/projection'
import { getDeferredToolExposureStore } from '../../../../tools/runtime/deferredToolExposure'

function resetStreamingBuffers(args: {
  assistantBufferRef: { current: string }
  thinkingBufferRef: { current: string }
  thinkingMessageIdRef: { current: string | null }
  thinkingLastFlushAtRef: { current: number }
  thinkingTimingRef: { current: { startedAtMs: number | null } }
  setThinkingText: Dispatch<SetStateAction<string>>
  setThinkingStartedAtMs: Dispatch<SetStateAction<number | null>>
}): void {
  args.assistantBufferRef.current = ''
  args.thinkingBufferRef.current = ''
  args.thinkingMessageIdRef.current = null
  args.thinkingLastFlushAtRef.current = 0
  args.thinkingTimingRef.current = { startedAtMs: null }
  args.setThinkingText('')
  args.setThinkingStartedAtMs(null)
}

function clearToolRuntimeState(args: {
  toolNameByIdRef: { current: Map<string, string> }
  toolInputByIdRef: { current: Map<string, unknown> }
  taskStatsByToolUseIdRef: { current: Map<string, { startedAt: number; toolUses: number; usage?: unknown }> }
  taskKindByToolUseIdRef: { current: Map<string, 'explore' | 'other'> }
  toolMessageIdByToolUseIdRef: { current: Map<string, string> }
  exploreBatchRef: { current: unknown | null }
}): void {
  args.toolNameByIdRef.current.clear()
  args.toolInputByIdRef.current.clear()
  args.taskStatsByToolUseIdRef.current.clear()
  args.taskKindByToolUseIdRef.current.clear()
  args.toolMessageIdByToolUseIdRef.current.clear()
  args.exploreBatchRef.current = null
}

function clearCanonicalTransientState(args: {
  transientSnapshotRef: { current: { turnId: string; includeAssistantStreaming: boolean; messages: unknown[] } | null }
  setCanonicalTurnMessages: Dispatch<SetStateAction<unknown[]>>
  setCanonicalTransientActive: Dispatch<SetStateAction<boolean>>
}): void {
  args.transientSnapshotRef.current = null
  args.setCanonicalTurnMessages([])
  args.setCanonicalTransientActive(false)
}

function resetSessionRefs(args: {
  deferredToolExposureSessionKeyRef: { current: string }
  historyRef: { current: unknown[] }
  pendingInjectedBlocksRef: { current: unknown[] }
  pendingExitPlanReminderRef: { current: boolean }
  currentAssistantIdRef: { current: string | null }
  contextBudgetConfigRef: { current: unknown | null }
  sendSeqRef: { current: number }
  autoCompactSeqRef: { current: number }
  claudeMdMetaSigRef: { current: string | null }
  clearToolRuntimeState: () => void
}): void {
  const deferredToolStore = getDeferredToolExposureStore()
  deferredToolStore.resetSession(args.deferredToolExposureSessionKeyRef.current)
  args.deferredToolExposureSessionKeyRef.current = randomUUID()

  args.historyRef.current = []
  args.pendingInjectedBlocksRef.current = []
  args.pendingExitPlanReminderRef.current = false
  args.currentAssistantIdRef.current = null
  args.contextBudgetConfigRef.current = null
  args.sendSeqRef.current = 0
  args.autoCompactSeqRef.current = -1_000_000
  args.clearToolRuntimeState()
  args.claudeMdMetaSigRef.current = null
}

function resetCanonicalProjectionState(args: {
  canonicalThreadId: string
  projectionRef: { current: ReturnType<typeof createInitialTranscriptProjectionState> }
  replaySeqRef: { current: number }
  turnIdRef: { current: string | null }
  turnSeqRef: { current: number }
  clearCanonicalTransientState: () => void
}): void {
  args.projectionRef.current = createInitialTranscriptProjectionState({ threadId: args.canonicalThreadId })
  args.replaySeqRef.current = 0
  args.turnIdRef.current = null
  args.turnSeqRef.current = 0
  args.clearCanonicalTransientState()
}

function resetSessionUiState(args: {
  resetStreamingBuffers: () => void
  setError: Dispatch<SetStateAction<string | null>>
  setContext: Dispatch<SetStateAction<null | { usedTokens: number; limitTokens: number; percentRemaining: number; source: 'estimate' | 'usage' }>>
}): void {
  args.resetStreamingBuffers()
  args.setError(null)
  args.setContext(null)
}

function nextCanonicalReplaySeq(replaySeqRef: { current: number }): number {
  replaySeqRef.current += 1
  return replaySeqRef.current
}

function nextCanonicalTurnSeq(turnSeqRef: { current: number }): number {
  turnSeqRef.current += 1
  return turnSeqRef.current
}

export {
  resetStreamingBuffers,
  clearToolRuntimeState,
  clearCanonicalTransientState,
  resetSessionRefs,
  resetCanonicalProjectionState,
  resetSessionUiState,
  nextCanonicalReplaySeq,
  nextCanonicalTurnSeq,
}
