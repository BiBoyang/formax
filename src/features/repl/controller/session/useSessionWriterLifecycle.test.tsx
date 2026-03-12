import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { useSessionWriterLifecycle } from './useSessionWriterLifecycle'

const {
  startNewSessionWriterInternalMock,
  openInitialSessionWriterInternalMock,
  shutdownSessionWriterInternalMock,
  ensureSessionWriterInternalMock,
} = vi.hoisted(() => ({
  startNewSessionWriterInternalMock: vi.fn(async () => undefined),
  openInitialSessionWriterInternalMock: vi.fn(async () => undefined),
  shutdownSessionWriterInternalMock: vi.fn(async () => undefined),
  ensureSessionWriterInternalMock: vi.fn(async () => undefined),
}))

vi.mock('./sessionLifecycle', async () => {
  const actual = await vi.importActual<typeof import('./sessionLifecycle')>('./sessionLifecycle')
  return {
    ...actual,
    startNewSessionWriter: startNewSessionWriterInternalMock,
    openInitialSessionWriter: openInitialSessionWriterInternalMock,
    shutdownSessionWriter: shutdownSessionWriterInternalMock,
    ensureSessionWriter: ensureSessionWriterInternalMock,
  }
})

type LifecycleApi = ReturnType<typeof useSessionWriterLifecycle>

function Harness(props: {
  apiRef: { current: LifecycleApi | null }
  sessionSaveEnabled: boolean
  cwd: string
  env: NodeJS.ProcessEnv
  model: string
  historyRef: { current: ChatHistory }
  refs: any
  initialSessionFilePathRef: { current: string | undefined }
  initialSessionMessages?: Msg[]
}) {
  props.apiRef.current = useSessionWriterLifecycle({
    sessionSaveEnabled: props.sessionSaveEnabled,
    cwd: props.cwd,
    env: props.env,
    model: props.model,
    historyRef: props.historyRef,
    refs: props.refs,
    initialSessionFilePathRef: props.initialSessionFilePathRef,
    initialSessionMessages: props.initialSessionMessages,
  })

  return <Text>ready</Text>
}

describe('useSessionWriterLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates start/open/shutdown/ensure operations to lifecycle helpers', async () => {
    const apiRef = { current: null as LifecycleApi | null }
    const historyRef = { current: [] as ChatHistory }
    const refs = {
      sessionWriterRef: { current: null },
      sessionWriterInitPromiseRef: { current: null },
      openInitialSessionWriterPromiseRef: { current: null },
      initialSessionFilePathRef: { current: undefined },
      historyRef,
      initialSessionMessagesRef: { current: [] as Msg[] },
      sessionSaveEnabledRef: { current: true },
      cwdRef: { current: '/tmp/cwd' },
      envRef: { current: process.env },
      modelRef: { current: 'sonnet' },
    }
    const initialSessionFilePathRef = { current: '/tmp/session.jsonl' as string | undefined }
    const initialSessionMessages: Msg[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'hello',
        timestamp: new Date(),
      },
    ]

    const app = render(
      <Harness
        apiRef={apiRef}
        sessionSaveEnabled={true}
        cwd='/tmp/cwd'
        env={process.env}
        model='sonnet'
        historyRef={historyRef}
        refs={refs}
        initialSessionFilePathRef={initialSessionFilePathRef}
        initialSessionMessages={initialSessionMessages}
      />,
    )

    await apiRef.current?.startNewSessionWriter()
    await apiRef.current?.openInitialSessionWriter()
    await apiRef.current?.shutdownSessionWriter()
    await apiRef.current?.ensureSessionWriter()

    expect(startNewSessionWriterInternalMock).toHaveBeenCalledWith({
      sessionSaveEnabled: true,
      cwd: '/tmp/cwd',
      env: process.env,
      model: 'sonnet',
      historyRef,
      refs,
    })

    expect(openInitialSessionWriterInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionSaveEnabled: true,
        historyRef,
        refs,
        startNewWriter: expect.any(Function),
        initialSession: {
          filePath: '/tmp/session.jsonl',
          messages: initialSessionMessages,
        },
      }),
    )

    expect(shutdownSessionWriterInternalMock).toHaveBeenCalledWith(refs)

    expect(ensureSessionWriterInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionSaveEnabled: true,
        refs,
        openInitialWriter: expect.any(Function),
      }),
    )

    app.unmount()
  })

  it('omits initial session file path when none is provided', async () => {
    const apiRef = { current: null as LifecycleApi | null }
    const historyRef = { current: [] as ChatHistory }
    const refs = {
      sessionWriterRef: { current: null },
      sessionWriterInitPromiseRef: { current: null },
      openInitialSessionWriterPromiseRef: { current: null },
      initialSessionFilePathRef: { current: undefined },
      historyRef,
      initialSessionMessagesRef: { current: [] as Msg[] },
      sessionSaveEnabledRef: { current: true },
      cwdRef: { current: '/tmp/cwd' },
      envRef: { current: process.env },
      modelRef: { current: 'sonnet' },
    }

    const app = render(
      <Harness
        apiRef={apiRef}
        sessionSaveEnabled={true}
        cwd='/tmp/cwd'
        env={process.env}
        model='sonnet'
        historyRef={historyRef}
        refs={refs}
        initialSessionFilePathRef={{ current: undefined }}
      />,
    )

    await apiRef.current?.openInitialSessionWriter()

    expect(openInitialSessionWriterInternalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSession: {},
      }),
    )

    app.unmount()
  })
})
