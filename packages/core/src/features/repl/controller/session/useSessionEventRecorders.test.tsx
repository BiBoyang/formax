import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LocalCommandRecord } from '../../../commands/registry'
import { useSessionEventRecorders } from './useSessionEventRecorders'

const { recordCompactRequestedEventMock, recordLocalCommandInjectionEventMock } = vi.hoisted(() => ({
  recordCompactRequestedEventMock: vi.fn(),
  recordLocalCommandInjectionEventMock: vi.fn(),
}))

vi.mock('./index', () => ({
  recordCompactRequestedEvent: recordCompactRequestedEventMock,
  recordLocalCommandInjectionEvent: recordLocalCommandInjectionEventMock,
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
})
