import { describe, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from '../../../config/config'
import type { ChatEngine } from '../../../chat/engine'
import type { ReplMode } from '../mode'
import {
  runAbortAction,
  runSendAction,
  type SendFlowCallbacks,
  type SendFlowDeps,
  type SendFlowRefs,
} from './turnActions'

function createSendHarness(args?: {
  value?: string
  isLoading?: boolean
  transitionPending?: number
  bashInFlight?: boolean
}) {
  const resetStreamingBuffers = vi.fn()
  const ensureSessionWriter = vi.fn(async () => undefined)

  const deps: SendFlowDeps = {
    cfg: { llm: { provider: 'anthropic', model: 'test' } } as RuntimeConfig,
    mode: 'default' as ReplMode,
    engine: {} as ChatEngine,
    tools: [],
  }
  const refs: SendFlowRefs = {
    bashModeInFlightRef: { current: args?.bashInFlight ?? false },
    sessionTransitionPendingCountRef: { current: args?.transitionPending ?? 0 },
    sessionWriterRef: { current: null },
    canonicalProjectionRef: { current: { threadId: 'tui-live', segments: [] } as any },
    modeCurrentRef: { current: 'default' as ReplMode },
    historyRef: { current: [] },
    pendingInjectedBlocksRef: { current: [] },
    contextBudgetConfigRef: { current: null },
    abortControllerRef: { current: null },
    assistantBufferRef: { current: '' },
    thinkingBufferRef: { current: '' },
    thinkingLastFlushAtRef: { current: 0 },
    currentAssistantIdRef: { current: null },
    pendingExitPlanReminderRef: { current: false },
    deferredToolExposureSessionKeyRef: { current: 'session-key' },
    sendSeqRef: { current: 0 },
    autoCompactSeqRef: { current: 0 },
    reminderServiceRef: { current: null },
    canonicalTurnIdRef: { current: null },
    claudeMdMetaSigRef: { current: null },
  }
  const callbacks: SendFlowCallbacks = {
    ensureSessionWriter,
    runNewSession: vi.fn(async () => undefined),
    resetStreamingBuffers,
    clearCanonicalTransientState: vi.fn(),
    setMessages: vi.fn(),
    setIsLoading: vi.fn(),
    setLoadingText: vi.fn(),
    setThinkingText: vi.fn(),
    setError: vi.fn(),
    setContext: vi.fn(),
    setReplMode: vi.fn(),
    setCanonicalTransientActive: vi.fn(),
    nextCanonicalTurnSeq: vi.fn(() => 1),
    nextCanonicalReplaySeq: vi.fn(() => 1),
    onCanonicalEvent: vi.fn(),
    onCompactLifecycle: vi.fn(),
    onCompactRequested: vi.fn(),
    onSlashLocalAsyncRecordForNextTurn: vi.fn(),
    onSlashLocalRecordForNextTurn: vi.fn(),
    openOverlay: vi.fn(),
    closeOverlay: vi.fn(),
    handleEvent: vi.fn(),
  }
  return {
    input: { value: args?.value ?? 'hello' },
    deps,
    refs,
    callbacks,
    runtime: {
      canonicalThreadId: 'tui-live',
      isLoading: args?.isLoading ?? false,
      runtimeFlags: {} as any,
      runtimeCwd: process.cwd(),
      runtimeEnv: process.env,
      allowedSubagents: [],
      sessionSaveEnabled: true,
    },
    spies: {
      resetStreamingBuffers,
      ensureSessionWriter,
    },
  }
}

describe('turnActions', () => {
  it('runSendAction blocks empty input before touching runtime callbacks', async () => {
    const harness = createSendHarness({ value: '   ' })
    await runSendAction(harness)
    expect(harness.spies.resetStreamingBuffers).not.toHaveBeenCalled()
    expect(harness.spies.ensureSessionWriter).not.toHaveBeenCalled()
  })

  it('runSendAction blocks while a session transition is pending', async () => {
    const harness = createSendHarness({ value: 'hi', transitionPending: 1 })
    await runSendAction(harness)
    expect(harness.spies.resetStreamingBuffers).not.toHaveBeenCalled()
    expect(harness.spies.ensureSessionWriter).not.toHaveBeenCalled()
  })

  it('runAbortAction clears canonical in-flight state and aborts controller', () => {
    const abort = vi.fn()
    const abortControllerRef = { current: { abort } as unknown as AbortController }
    const setIsLoading = vi.fn()
    const clearCanonicalTransientState = vi.fn()
    const clearToolRuntimeState = vi.fn()
    const resetSessionUiState = vi.fn()
    const clearBufferedAnswers = vi.fn()
    const rejectAllPending = vi.fn()

    runAbortAction({
      canonicalThreadId: 'tui-live',
      canonicalTurnIdRef: { current: 'turn-1' },
      canonicalTransientSnapshotRef: { current: null },
      toolNameByIdRef: { current: new Map() },
      isLoading: true,
      abortControllerRef,
      bashModeInFlightRef: { current: true },
      userInput: {
        clearBufferedAnswers,
        rejectAllPending,
      } as any,
      resetSessionUiState,
      clearCanonicalTransientState,
      clearToolRuntimeState,
      currentAssistantIdRef: { current: null },
      setMessages: vi.fn(),
      setIsLoading,
      nextCanonicalReplaySeq: () => 1,
      onCanonicalEvent: vi.fn(),
    })

    expect(abort).toHaveBeenCalledTimes(1)
    expect(abortControllerRef.current).toBeNull()
    expect(clearBufferedAnswers).toHaveBeenCalledTimes(1)
    expect(rejectAllPending).toHaveBeenCalledTimes(1)
    expect(resetSessionUiState).toHaveBeenCalledTimes(1)
    expect(setIsLoading).toHaveBeenCalledWith(false)
    expect(clearToolRuntimeState).toHaveBeenCalledTimes(1)
    expect(clearCanonicalTransientState).toHaveBeenCalledTimes(1)
  })
})
