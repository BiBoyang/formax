import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { useSessionActions } from './useSessionActions'

const {
  runNewSessionActionMock,
  runResumeSessionActionMock,
  renameSessionActionMock,
} = vi.hoisted(() => ({
  runNewSessionActionMock: vi.fn(async (_args: any) => undefined),
  runResumeSessionActionMock: vi.fn(async (_args: any) => undefined),
  renameSessionActionMock: vi.fn(async () => undefined),
}))

vi.mock('./sessionActions', () => ({
  runNewSessionAction: runNewSessionActionMock,
  runResumeSessionAction: runResumeSessionActionMock,
  renameSessionAction: renameSessionActionMock,
}))

type SessionActionsApi = ReturnType<typeof useSessionActions>

function Harness(props: {
  apiRef: { current: SessionActionsApi | null }
  args: Parameters<typeof useSessionActions>[0]
}) {
  props.apiRef.current = useSessionActions(props.args)
  return <Text>ready</Text>
}

function createArgs(overrides?: Partial<Parameters<typeof useSessionActions>[0]>): Parameters<typeof useSessionActions>[0] {
  return {
    engine: { beginNewSession: vi.fn() } as any,
    isLoading: false,
    closeResumeDialog: vi.fn(),
    sessionSaveEnabled: true,
    initialSessionFilePathRef: { current: undefined },
    sessionTransitionQueueRef: { current: Promise.resolve() },
    sessionTransitionPendingCountRef: { current: 0 },
    sessionWriterRef: { current: null },
    sessionWriterInitPromiseRef: { current: null },
    lastPersistedSigByMsgIdRef: { current: new Map<string, string>() },
    lastPersistedMsgByIdRef: { current: new Map<string, Msg>() },
    resetSessionState: vi.fn(),
    replaceTranscript: vi.fn(async (_next: Msg[]) => undefined),
    historyRef: { current: [] as ChatHistory },
    abort: vi.fn(),
    setError: vi.fn(),
    runNewSessionTransition: vi.fn(async () => undefined) as any,
    runResumeSessionTransition: vi.fn(async () => undefined) as any,
    readSessionFile: vi.fn(async () => ({ messages: [], history: [] as ChatHistory })) as any,
    openExistingSessionWriter: vi.fn(async () => ({ appendEvent: vi.fn(), shutdown: vi.fn() })) as any,
    buildPersistedSigMap: vi.fn(() => new Map<string, string>()) as any,
    buildPersistedMsgRefMap: vi.fn(() => new Map<string, Msg>()) as any,
    ...overrides,
  }
}

describe('useSessionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wires runNewSession/newSession to runNewSessionAction with clear source', async () => {
    const apiRef = { current: null as SessionActionsApi | null }
    const args = createArgs()

    const app = render(<Harness apiRef={apiRef} args={args} />)

    await apiRef.current?.runNewSession()
    expect(runNewSessionActionMock).toHaveBeenCalledTimes(1)

    const runArgs = runNewSessionActionMock.mock.calls[0]?.[0]
    expect(runArgs).toBeDefined()
    if (!runArgs) throw new Error('runNewSessionAction args missing')
    expect(runArgs).toEqual(
      expect.objectContaining({
        sessionSaveEnabled: true,
        resetSessionState: args.resetSessionState,
        replaceTranscript: args.replaceTranscript,
      }),
    )

    runArgs.beginNewSession()
    expect(args.engine.beginNewSession).toHaveBeenCalledWith({ source: 'clear' })

    apiRef.current?.newSession()
    await Promise.resolve()
    expect(runNewSessionActionMock).toHaveBeenCalledTimes(2)

    app.unmount()
  })

  it('wires resumeSession to runResumeSessionAction with resume source and deps', async () => {
    const apiRef = { current: null as SessionActionsApi | null }
    const args = createArgs({ isLoading: true })

    const app = render(<Harness apiRef={apiRef} args={args} />)

    await apiRef.current?.resumeSession('/tmp/session.jsonl')

    expect(runResumeSessionActionMock).toHaveBeenCalledTimes(1)
    const resumeArgs = runResumeSessionActionMock.mock.calls[0]?.[0]
    expect(resumeArgs).toBeDefined()
    if (!resumeArgs) throw new Error('runResumeSessionAction args missing')
    expect(resumeArgs).toEqual(
      expect.objectContaining({
        filePath: '/tmp/session.jsonl',
        isLoading: true,
        closeResumeDialog: args.closeResumeDialog,
        abort: args.abort,
        setError: args.setError,
        replaceTranscript: args.replaceTranscript,
      }),
    )

    resumeArgs.beginNewSession()
    expect(args.engine.beginNewSession).toHaveBeenCalledWith({ source: 'resume' })

    app.unmount()
  })

  it('delegates renameSession to renameSessionAction', async () => {
    const apiRef = { current: null as SessionActionsApi | null }
    const args = createArgs()

    const app = render(<Harness apiRef={apiRef} args={args} />)

    await apiRef.current?.renameSession('/tmp/session.jsonl', 'Pinned Session')

    expect(renameSessionActionMock).toHaveBeenCalledWith('/tmp/session.jsonl', 'Pinned Session')

    app.unmount()
  })
})
