import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LocalCommandRecord } from '../../../commands/registry'
import { useSessionEventRecorders } from './useSessionEventRecorders'

const {
  recordCompactRequestedEventMock,
  recordLocalCommandInjectionEventMock,
  recordReactiveCompactEventMock,
  recordRequestCollapseEventMock,
  recordRequestSnipEventMock,
} = vi.hoisted(() => ({
  recordCompactRequestedEventMock: vi.fn(),
  recordLocalCommandInjectionEventMock: vi.fn(),
  recordReactiveCompactEventMock: vi.fn(),
  recordRequestCollapseEventMock: vi.fn(),
  recordRequestSnipEventMock: vi.fn(),
}))

vi.mock('./sessionEvents', () => ({
  recordCompactRequestedEvent: recordCompactRequestedEventMock,
  recordLocalCommandInjectionEvent: recordLocalCommandInjectionEventMock,
  recordReactiveCompactEvent: recordReactiveCompactEventMock,
  recordRequestCollapseEvent: recordRequestCollapseEventMock,
  recordRequestSnipEvent: recordRequestSnipEventMock,
}))

type RecorderApi = ReturnType<typeof useSessionEventRecorders>

function Harness(props: {
  apiRef: { current: RecorderApi | null }
  sessionSaveEnabled: boolean
  writerRef: { current: { appendEvent: (name: string, data?: Record<string, unknown>) => Promise<void> } | null }
}) {
  props.apiRef.current = useSessionEventRecorders({
    sessionSaveEnabled: props.sessionSaveEnabled,
    writerRef: props.writerRef as any,
  })

  return <Text>ready</Text>
}

describe('useSessionEventRecorders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records compact lifecycle events when session save is enabled', async () => {
    const appendEvent = vi.fn(async () => undefined)
    const apiRef = { current: null as RecorderApi | null }

    const app = render(
      <Harness
        apiRef={apiRef}
        sessionSaveEnabled={true}
        writerRef={{ current: { appendEvent } }}
      />,
    )

    apiRef.current?.onCompactLifecycle({ type: 'compact_started', source: 'manual' })
    apiRef.current?.onCompactLifecycle({ type: 'compact_succeeded', source: 'manual' })
    apiRef.current?.onCompactLifecycle({ type: 'compact_failed', source: 'manual', error: 'boom' })

    expect(appendEvent).toHaveBeenNthCalledWith(1, 'compact_started', { source: 'manual' })
    expect(appendEvent).toHaveBeenNthCalledWith(2, 'compact_succeeded', { source: 'manual' })
    expect(appendEvent).toHaveBeenNthCalledWith(3, 'compact_failed', {
      source: 'manual',
      error: 'boom',
    })

    app.unmount()
  })

  it('skips compact lifecycle writes when session save is disabled', async () => {
    const appendEvent = vi.fn(async () => undefined)
    const apiRef = { current: null as RecorderApi | null }

    const app = render(
      <Harness
        apiRef={apiRef}
        sessionSaveEnabled={false}
        writerRef={{ current: { appendEvent } }}
      />,
    )

    apiRef.current?.onCompactLifecycle({ type: 'compact_started', source: 'manual' })

    expect(appendEvent).not.toHaveBeenCalled()

    app.unmount()
  })

  it('delegates compact-requested and slash-local recorders to session helpers', async () => {
    const appendEvent = vi.fn(async () => undefined)
    const writer = { appendEvent }
    const writerRef = { current: writer }
    const apiRef = { current: null as RecorderApi | null }
    const record: LocalCommandRecord = {
      commandName: '/todos',
      commandMessage: 'todos',
      commandArgs: '',
      stdout: 'ok',
    }

    const app = render(
      <Harness
        apiRef={apiRef}
        sessionSaveEnabled={true}
        writerRef={writerRef}
      />,
    )

    apiRef.current?.onCompactRequested()
    apiRef.current?.onSlashLocalRecordForNextTurn(record)
    apiRef.current?.onSlashLocalAsyncRecordForNextTurn(record)

    expect(recordCompactRequestedEventMock).toHaveBeenCalledWith({
      sessionSaveEnabled: true,
      writer,
    })
    expect(recordLocalCommandInjectionEventMock).toHaveBeenNthCalledWith(1, {
      sessionSaveEnabled: true,
      writer,
      source: 'slash_local',
      record,
    })
    expect(recordLocalCommandInjectionEventMock).toHaveBeenNthCalledWith(2, {
      sessionSaveEnabled: true,
      writer,
      source: 'slash_local_async',
      record,
    })

    app.unmount()
  })

  it('delegates request-time collapse events to session helpers', async () => {
    const appendEvent = vi.fn(async () => undefined)
    const writer = { appendEvent }
    const writerRef = { current: writer }
    const apiRef = { current: null as RecorderApi | null }

    const app = render(
      <Harness
        apiRef={apiRef}
        sessionSaveEnabled={true}
        writerRef={writerRef}
      />,
    )

    await apiRef.current?.onRequestCollapse({
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 120,
      metadata: {
        schemaVersion: 1,
        kind: 'request_recap',
        keepLastTurns: 2,
        preservedTailMessageCount: 4,
        retainedCompactSummary: true,
        recentUserPromptCount: 2,
        recentFileCount: 1,
        earlierToolResultBlockCount: 5,
        recapFingerprint: 'abcdef0123456789',
      },
      commit: null,
    })

    expect(recordRequestCollapseEventMock).toHaveBeenCalledWith({
      sessionSaveEnabled: true,
      writer,
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 120,
      metadata: {
        schemaVersion: 1,
        kind: 'request_recap',
        keepLastTurns: 2,
        preservedTailMessageCount: 4,
        retainedCompactSummary: true,
        recentUserPromptCount: 2,
        recentFileCount: 1,
        earlierToolResultBlockCount: 5,
        recapFingerprint: 'abcdef0123456789',
      },
      commit: null,
    })

    app.unmount()
  })

  it('delegates request-time snip events to session helpers', async () => {
    const appendEvent = vi.fn(async () => undefined)
    const writer = { appendEvent }
    const writerRef = { current: writer }
    const apiRef = { current: null as RecorderApi | null }

    const app = render(<Harness apiRef={apiRef} sessionSaveEnabled={true} writerRef={writerRef} />)

    const state = {
      applied: true,
      removedMessageCount: 1,
      estimatedTokensSaved: 120,
      compactBoundaryFingerprint: 'compact-fp',
      baseProjectionFingerprint: 'baseline-fp',
      sourceProjectionKind: 'model_facing_baseline' as const,
      removals: [
        {
          kind: 'model_facing_index_range' as const,
          startIndex: 1,
          endIndexExclusive: 2,
          reason: 'request snip removed older assistant text message',
          removedMessageFingerprints: ['removed-fp'],
        },
      ],
    }
    await apiRef.current?.onRequestSnip({ phase: 'initial', state })

    expect(recordRequestSnipEventMock).toHaveBeenCalledWith({
      sessionSaveEnabled: true,
      writer,
      phase: 'initial',
      state,
    })

    app.unmount()
  })

  it('delegates reactive compact events to session helpers', async () => {
    const appendEvent = vi.fn(async () => undefined)
    const writer = { appendEvent }
    const writerRef = { current: writer }
    const apiRef = { current: null as RecorderApi | null }

    const app = render(<Harness apiRef={apiRef} sessionSaveEnabled={true} writerRef={writerRef} />)

    apiRef.current?.onReactiveCompact({
      triggerKind: 'maximum_context_length',
      triggerDetail: "This model's maximum context length is 200000 tokens.",
      strategy: 'session_memory',
    })

    expect(recordReactiveCompactEventMock).toHaveBeenCalledWith({
      sessionSaveEnabled: true,
      writer,
      triggerKind: 'maximum_context_length',
      triggerDetail: "This model's maximum context length is 200000 tokens.",
      strategy: 'session_memory',
    })

    app.unmount()
  })
})
