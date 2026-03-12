import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { useTranscriptSurfaceActions } from './useTranscriptSurfaceActions'

const { queueTranscriptSurfaceResetMock, queueTranscriptSurfaceReplaceMock } = vi.hoisted(() => ({
  queueTranscriptSurfaceResetMock: vi.fn(async () => undefined),
  queueTranscriptSurfaceReplaceMock: vi.fn(async () => undefined),
}))

vi.mock('./index', () => ({
  queueTranscriptSurfaceReset: queueTranscriptSurfaceResetMock,
  queueTranscriptSurfaceReplace: queueTranscriptSurfaceReplaceMock,
}))

type SurfaceApi = ReturnType<typeof useTranscriptSurfaceActions>

function Harness(props: {
  apiRef: { current: SurfaceApi | null }
  surfaceOpQueueRef: { current: Promise<void> }
  onClearTerminal?: () => void | Promise<void>
  setTranscriptSeq: (updater: (prev: number) => number) => void
  setMessages: (updater: (prev: Msg[]) => Msg[]) => void
}) {
  props.apiRef.current = useTranscriptSurfaceActions({
    surfaceOpQueueRef: props.surfaceOpQueueRef,
    onClearTerminal: props.onClearTerminal,
    setTranscriptSeq: props.setTranscriptSeq as any,
    setMessages: props.setMessages as any,
  })

  return <Text>ready</Text>
}

describe('useTranscriptSurfaceActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates resetTranscriptSurface to queueTranscriptSurfaceReset', async () => {
    const apiRef = { current: null as SurfaceApi | null }
    const surfaceOpQueueRef = { current: Promise.resolve() }
    const onClearTerminal = vi.fn()
    const setTranscriptSeq = vi.fn()
    const setMessages = vi.fn()

    const app = render(
      <Harness
        apiRef={apiRef}
        surfaceOpQueueRef={surfaceOpQueueRef}
        onClearTerminal={onClearTerminal}
        setTranscriptSeq={setTranscriptSeq}
        setMessages={setMessages}
      />,
    )

    await apiRef.current?.resetTranscriptSurface()

    expect(queueTranscriptSurfaceResetMock).toHaveBeenCalledWith({
      surfaceOpQueueRef,
      onClearTerminal,
      setTranscriptSeq,
    })

    app.unmount()
  })

  it('delegates replaceTranscript to queueTranscriptSurfaceReplace', async () => {
    const apiRef = { current: null as SurfaceApi | null }
    const surfaceOpQueueRef = { current: Promise.resolve() }
    const onClearTerminal = vi.fn()
    const setTranscriptSeq = vi.fn()
    const setMessages = vi.fn()
    const nextMessages: Msg[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'hello',
        timestamp: new Date(),
      },
    ]

    const app = render(
      <Harness
        apiRef={apiRef}
        surfaceOpQueueRef={surfaceOpQueueRef}
        onClearTerminal={onClearTerminal}
        setTranscriptSeq={setTranscriptSeq}
        setMessages={setMessages}
      />,
    )

    await apiRef.current?.replaceTranscript(nextMessages)

    expect(queueTranscriptSurfaceReplaceMock).toHaveBeenCalledWith({
      surfaceOpQueueRef,
      onClearTerminal,
      setTranscriptSeq,
      setMessages,
      nextMessages,
    })

    app.unmount()
  })
})
