import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { useSessionResetActions } from './useSessionResetActions'

const {
  resetStreamingBuffersInternalMock,
  clearToolRuntimeStateInternalMock,
  clearCanonicalTransientStateInternalMock,
  resetSessionRefsInternalMock,
  resetCanonicalProjectionStateInternalMock,
  resetSessionUiStateInternalMock,
  nextCanonicalReplaySeqInternalMock,
  nextCanonicalTurnSeqInternalMock,
} = vi.hoisted(() => ({
  resetStreamingBuffersInternalMock: vi.fn(),
  clearToolRuntimeStateInternalMock: vi.fn(),
  clearCanonicalTransientStateInternalMock: vi.fn(),
  resetSessionRefsInternalMock: vi.fn(),
  resetCanonicalProjectionStateInternalMock: vi.fn(),
  resetSessionUiStateInternalMock: vi.fn(),
  nextCanonicalReplaySeqInternalMock: vi.fn(() => 11),
  nextCanonicalTurnSeqInternalMock: vi.fn(() => 22),
}))

vi.mock('./sessionReset', () => ({
  resetStreamingBuffers: resetStreamingBuffersInternalMock,
  clearToolRuntimeState: clearToolRuntimeStateInternalMock,
  clearCanonicalTransientState: clearCanonicalTransientStateInternalMock,
  resetSessionRefs: resetSessionRefsInternalMock,
  resetCanonicalProjectionState: resetCanonicalProjectionStateInternalMock,
  resetSessionUiState: resetSessionUiStateInternalMock,
  nextCanonicalReplaySeq: nextCanonicalReplaySeqInternalMock,
  nextCanonicalTurnSeq: nextCanonicalTurnSeqInternalMock,
}))

type ResetActionsApi = ReturnType<typeof useSessionResetActions>

function Harness(props: {
  apiRef: { current: ResetActionsApi | null }
  args: Parameters<typeof useSessionResetActions>[0]
}) {
  props.apiRef.current = useSessionResetActions(props.args)
  return <Text>ready</Text>
}

function createArgs(): Parameters<typeof useSessionResetActions>[0] {
  const sessionRefs = {
    deferredToolExposureSessionKeyRef: { current: 'session-key' },
    historyRef: { current: [] },
    currentAssistantIdRef: { current: null },
    assistantBufferRef: { current: '' },
  }
  const thinkingRefs = {
    bufferRef: { current: '' },
    messageIdRef: { current: null },
    lastFlushAtRef: { current: 0 },
    timingRef: { current: { startedAtMs: null } },
  }
  const toolRuntimeRefs = {
    nameByIdRef: { current: new Map() },
    inputByIdRef: { current: new Map() },
    statsByToolUseIdRef: { current: new Map() },
    kindByToolUseIdRef: { current: new Map() },
    messageIdByToolUseIdRef: { current: new Map() },
    exploreBatchRef: { current: null },
  }
  const canonicalRefs = {
    projectionRef: { current: { threadId: 'tui-live', segments: [] } as any },
    replaySeqRef: { current: 0 },
    turnIdRef: { current: null },
    turnSeqRef: { current: 0 },
    transientSnapshotRef: { current: null },
  }
  const turnFlowRefs = {
    pendingInjectedBlocksRef: { current: [] },
    pendingExitPlanReminderRef: { current: false },
    contextBudgetConfigRef: { current: null },
  }
  const runtimeStateRefs = {
    sendSeqRef: { current: 0 },
    autoCompactSeqRef: { current: -1_000_000 },
    claudeMdMetaSigRef: { current: null },
  }
  const setters = {
    setThinkingText: vi.fn(),
    setThinkingStartedAtMs: vi.fn(),
    setCanonicalTurnMessages: vi.fn() as any,
    setCanonicalTransientActive: vi.fn(),
    setError: vi.fn(),
    setContext: vi.fn(),
  }

  return {
    canonicalThreadId: 'tui-live',
    sessionRefs,
    thinkingRefs,
    toolRuntimeRefs,
    canonicalRefs,
    turnFlowRefs,
    runtimeStateRefs,
    setters,
  }
}

describe('useSessionResetActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates granular reset callbacks to sessionReset helpers', () => {
    const apiRef = { current: null as ResetActionsApi | null }
    const args = createArgs()

    const app = render(<Harness apiRef={apiRef} args={args} />)

    apiRef.current?.resetStreamingBuffers()
    apiRef.current?.clearToolRuntimeState()
    apiRef.current?.clearCanonicalTransientState()
    apiRef.current?.resetSessionUiState()

    expect(resetStreamingBuffersInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantBufferRef: args.sessionRefs.assistantBufferRef,
        thinkingBufferRef: args.thinkingRefs.bufferRef,
      }),
    )
    expect(clearToolRuntimeStateInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolNameByIdRef: args.toolRuntimeRefs.nameByIdRef,
        exploreBatchRef: args.toolRuntimeRefs.exploreBatchRef,
      }),
    )
    expect(clearCanonicalTransientStateInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transientSnapshotRef: args.canonicalRefs.transientSnapshotRef,
      }),
    )
    expect(resetSessionUiStateInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        setError: args.setters.setError,
        setContext: args.setters.setContext,
      }),
    )

    app.unmount()
  })

  it('composes resetSessionState in stable transaction order', () => {
    const apiRef = { current: null as ResetActionsApi | null }
    const args = createArgs()
    const order: string[] = []

    resetSessionRefsInternalMock.mockImplementation(() => {
      order.push('refs')
    })
    resetCanonicalProjectionStateInternalMock.mockImplementation(() => {
      order.push('canonical')
    })
    resetSessionUiStateInternalMock.mockImplementation(() => {
      order.push('ui')
    })

    const app = render(<Harness apiRef={apiRef} args={args} />)

    apiRef.current?.resetSessionState()

    expect(order).toEqual(['refs', 'canonical', 'ui'])
    expect(resetSessionRefsInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deferredToolExposureSessionKeyRef: args.sessionRefs.deferredToolExposureSessionKeyRef,
        clearToolRuntimeState: expect.any(Function),
      }),
    )
    expect(resetCanonicalProjectionStateInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalThreadId: 'tui-live',
        clearCanonicalTransientState: expect.any(Function),
      }),
    )

    app.unmount()
  })

  it('delegates canonical sequence increment helpers', () => {
    const apiRef = { current: null as ResetActionsApi | null }
    const args = createArgs()

    const app = render(<Harness apiRef={apiRef} args={args} />)

    expect(apiRef.current?.nextCanonicalReplaySeq()).toBe(11)
    expect(apiRef.current?.nextCanonicalTurnSeq()).toBe(22)
    expect(nextCanonicalReplaySeqInternalMock).toHaveBeenCalledWith(args.canonicalRefs.replaySeqRef)
    expect(nextCanonicalTurnSeqInternalMock).toHaveBeenCalledWith(args.canonicalRefs.turnSeqRef)

    app.unmount()
  })
})
