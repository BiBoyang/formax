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
  return {
    canonicalThreadId: 'tui-live',
    assistantBufferRef: { current: '' },
    thinkingBufferRef: { current: '' },
    thinkingMessageIdRef: { current: null },
    thinkingLastFlushAtRef: { current: 0 },
    thinkingTimingRef: { current: { startedAtMs: null } },
    setThinkingText: vi.fn(),
    setThinkingStartedAtMs: vi.fn(),
    toolNameByIdRef: { current: new Map() },
    toolInputByIdRef: { current: new Map() },
    taskStatsByToolUseIdRef: { current: new Map() },
    taskKindByToolUseIdRef: { current: new Map() },
    toolMessageIdByToolUseIdRef: { current: new Map() },
    exploreBatchRef: { current: null },
    transientSnapshotRef: { current: null },
    setCanonicalTurnMessages: vi.fn() as any,
    setCanonicalTransientActive: vi.fn(),
    deferredToolExposureSessionKeyRef: { current: 'session-key' },
    historyRef: { current: [] },
    pendingInjectedBlocksRef: { current: [] },
    pendingExitPlanReminderRef: { current: false },
    currentAssistantIdRef: { current: null },
    contextBudgetConfigRef: { current: null },
    sendSeqRef: { current: 0 },
    autoCompactSeqRef: { current: -1_000_000 },
    claudeMdMetaSigRef: { current: null },
    projectionRef: { current: { threadId: 'tui-live', segments: [] } as any },
    replaySeqRef: { current: 0 },
    turnIdRef: { current: null },
    turnSeqRef: { current: 0 },
    setError: vi.fn(),
    setContext: vi.fn(),
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
        assistantBufferRef: args.assistantBufferRef,
        thinkingBufferRef: args.thinkingBufferRef,
      }),
    )
    expect(clearToolRuntimeStateInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolNameByIdRef: args.toolNameByIdRef,
        exploreBatchRef: args.exploreBatchRef,
      }),
    )
    expect(clearCanonicalTransientStateInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transientSnapshotRef: args.transientSnapshotRef,
      }),
    )
    expect(resetSessionUiStateInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        setError: args.setError,
        setContext: args.setContext,
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
        deferredToolExposureSessionKeyRef: args.deferredToolExposureSessionKeyRef,
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
    expect(nextCanonicalReplaySeqInternalMock).toHaveBeenCalledWith(args.replaySeqRef)
    expect(nextCanonicalTurnSeqInternalMock).toHaveBeenCalledWith(args.turnSeqRef)

    app.unmount()
  })
})
