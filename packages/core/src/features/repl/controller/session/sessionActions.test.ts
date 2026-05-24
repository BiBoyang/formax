import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'

const { openExistingMock } = vi.hoisted(() => ({
  openExistingMock: vi.fn(),
}))

vi.mock('../../sessionSave/writer', () => ({
  SessionWriter: {
    openExisting: openExistingMock,
  },
}))

import {
  queueSessionTransition,
  renameSessionAction,
  runNewSessionAction,
  runResumeSessionAction,
} from './sessionActions'

describe('sessionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('serializes transition queue runs through queueSessionTransition', async () => {
    const sessionTransitionQueueRef = { current: Promise.resolve() }
    const sessionTransitionPendingCountRef = { current: 0 }
    const order: string[] = []

    let releaseFirst: (() => void) | null = null
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = queueSessionTransition({
      sessionTransitionQueueRef,
      sessionTransitionPendingCountRef,
      run: async () => {
        order.push('start-1')
        await firstGate
        order.push('end-1')
      },
    })

    const second = queueSessionTransition({
      sessionTransitionQueueRef,
      sessionTransitionPendingCountRef,
      run: async () => {
        order.push('run-2')
      },
    })

    expect(sessionTransitionPendingCountRef.current).toBe(2)

    await Promise.resolve()
    await Promise.resolve()

    releaseFirst?.()
    await Promise.all([first, second])

    expect(order).toEqual(['start-1', 'end-1', 'run-2'])
    expect(sessionTransitionPendingCountRef.current).toBe(0)
  })

  it('runs new-session transition via queue and resets initial path', async () => {
    const initialSessionFilePathRef = { current: '/tmp/old.jsonl' as string | undefined }
    const sessionTransitionQueueRef = { current: Promise.resolve() }
    const sessionTransitionPendingCountRef = { current: 0 }
    const runNewSessionTransition = vi.fn(async () => undefined)
    const beginNewSession = vi.fn()
    const resetSessionState = vi.fn()
    const replaceTranscript = vi.fn(async (_messages: Msg[]) => undefined)

    await runNewSessionAction({
      initialSessionFilePathRef,
      sessionTransitionQueueRef,
      sessionTransitionPendingCountRef,
      runNewSessionTransition,
      beginNewSession,
      sessionSaveEnabled: true,
      sessionWriterRef: { current: null },
      sessionWriterInitPromiseRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map<string, string>() },
      lastPersistedMsgByIdRef: { current: new Map<string, Msg>() },
      resetSessionState,
      replaceTranscript,
    })

    expect(initialSessionFilePathRef.current).toBeUndefined()
    expect(runNewSessionTransition).toHaveBeenCalledTimes(1)
    expect(runNewSessionTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        beginNewSession,
        resetSessionState,
        replaceTranscript,
        sessionSaveEnabled: true,
      }),
    )
    expect(sessionTransitionPendingCountRef.current).toBe(0)
  })

  it('returns early when resume is already loading', async () => {
    const closeResumeDialog = vi.fn()
    const abort = vi.fn()
    const runResumeSessionTransition = vi.fn(async () => undefined)
    const setError = vi.fn()
    const initialSessionFilePathRef = { current: undefined as string | undefined }

    await runResumeSessionAction({
      filePath: '/tmp/session.jsonl',
      isLoading: true,
      closeResumeDialog,
      initialSessionFilePathRef,
      sessionTransitionQueueRef: { current: Promise.resolve() },
      sessionTransitionPendingCountRef: { current: 0 },
      abort,
      runResumeSessionTransition,
      readSessionFile: vi.fn(),
      beginNewSession: vi.fn(),
      sessionSaveEnabled: true,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map<string, string>() },
      lastPersistedMsgByIdRef: { current: new Map<string, Msg>() },
      resetSessionState: vi.fn(),
      historyRef: { current: [] as ChatHistory },
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      replaceTranscript: vi.fn(async (_messages: Msg[]) => undefined),
      openExistingSessionWriter: vi.fn(),
      buildPersistedSigMap: vi.fn(() => new Map<string, string>()),
      buildPersistedMsgRefMap: vi.fn(() => new Map<string, Msg>()),
      setError,
    })

    expect(closeResumeDialog).not.toHaveBeenCalled()
    expect(abort).not.toHaveBeenCalled()
    expect(runResumeSessionTransition).not.toHaveBeenCalled()
    expect(initialSessionFilePathRef.current).toBeUndefined()
    expect(setError).not.toHaveBeenCalled()
  })

  it('runs resume transition and propagates dependencies on success', async () => {
    const closeResumeDialog = vi.fn()
    const abort = vi.fn()
    const runResumeSessionTransition = vi.fn(async () => undefined)
    const setError = vi.fn()
    const initialSessionFilePathRef = { current: undefined as string | undefined }
    const sessionTransitionQueueRef = { current: Promise.resolve() }
    const sessionTransitionPendingCountRef = { current: 0 }

    const readSessionFile = vi.fn(async () => ({
      messages: [] as Msg[],
      history: [] as ChatHistory,
    }))
    const beginNewSession = vi.fn()
    const resetSessionState = vi.fn()
    const replaceTranscript = vi.fn(async (_messages: Msg[]) => undefined)
    const openExistingSessionWriter = vi.fn()
    const buildPersistedSigMap = vi.fn(() => new Map<string, string>())
    const buildPersistedMsgRefMap = vi.fn(() => new Map<string, Msg>())

    await runResumeSessionAction({
      filePath: '/tmp/session.jsonl',
      isLoading: false,
      closeResumeDialog,
      initialSessionFilePathRef,
      sessionTransitionQueueRef,
      sessionTransitionPendingCountRef,
      abort,
      runResumeSessionTransition,
      readSessionFile,
      beginNewSession,
      sessionSaveEnabled: true,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map<string, string>() },
      lastPersistedMsgByIdRef: { current: new Map<string, Msg>() },
      resetSessionState,
      historyRef: { current: [] as ChatHistory },
      cwd: '/repo',
      mode: 'plan',
      planPath: '/repo/.formax/plan.md',
      replaceTranscript,
      openExistingSessionWriter,
      buildPersistedSigMap,
      buildPersistedMsgRefMap,
      setError,
    })

    expect(closeResumeDialog).toHaveBeenCalledTimes(1)
    expect(initialSessionFilePathRef.current).toBe('/tmp/session.jsonl')
    expect(abort).toHaveBeenCalledTimes(1)
    expect(runResumeSessionTransition).toHaveBeenCalledTimes(1)
    expect(runResumeSessionTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/session.jsonl',
        readSessionFile,
        beginNewSession,
        resetSessionState,
        replaceTranscript,
        openExistingSessionWriter,
        buildPersistedSigMap,
        buildPersistedMsgRefMap,
      }),
    )
    expect(sessionTransitionPendingCountRef.current).toBe(0)
    expect(setError).not.toHaveBeenCalled()
  })

  it('sets user-visible error when resume transition throws', async () => {
    const closeResumeDialog = vi.fn()
    const abort = vi.fn()
    const setError = vi.fn()

    await runResumeSessionAction({
      filePath: '/tmp/session.jsonl',
      isLoading: false,
      closeResumeDialog,
      initialSessionFilePathRef: { current: undefined },
      sessionTransitionQueueRef: { current: Promise.resolve() },
      sessionTransitionPendingCountRef: { current: 0 },
      abort,
      runResumeSessionTransition: vi.fn(async () => {
        throw new Error('boom')
      }),
      readSessionFile: vi.fn(),
      beginNewSession: vi.fn(),
      sessionSaveEnabled: true,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map<string, string>() },
      lastPersistedMsgByIdRef: { current: new Map<string, Msg>() },
      resetSessionState: vi.fn(),
      historyRef: { current: [] as ChatHistory },
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      replaceTranscript: vi.fn(async (_messages: Msg[]) => undefined),
      openExistingSessionWriter: vi.fn(),
      buildPersistedSigMap: vi.fn(() => new Map<string, string>()),
      buildPersistedMsgRefMap: vi.fn(() => new Map<string, Msg>()),
      setError,
    })

    expect(closeResumeDialog).toHaveBeenCalledTimes(1)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenCalledWith('Failed to resume session: boom')
  })

  it('renames session by writing a session_rename event', async () => {
    const appendEvent = vi.fn(async () => undefined)
    const shutdown = vi.fn(async () => undefined)
    openExistingMock.mockResolvedValue({ appendEvent, shutdown })

    await renameSessionAction('/tmp/session.jsonl', 'Pinned Session')

    expect(openExistingMock).toHaveBeenCalledWith({ filePath: '/tmp/session.jsonl' })
    expect(appendEvent).toHaveBeenCalledWith('session_rename', { label: 'Pinned Session', source: 'manual' })
    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})
