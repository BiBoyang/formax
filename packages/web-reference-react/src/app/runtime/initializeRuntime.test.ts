import { describe, expect, it, vi } from 'vitest'
import { initializeRuntime } from './initializeRuntime'

describe('initializeRuntime', () => {
  it('runs handshake, refreshes, then resumes and replays active thread', async () => {
    const calls: string[] = []
    const initializeHandshake = vi.fn(async () => {
      calls.push('handshake')
    })
    const refreshThreads = vi.fn(async () => {
      calls.push('threads')
    })
    const refreshWorkspaceDiff = vi.fn(async () => {
      calls.push('diff')
    })
    const resumeThreadInputs = vi.fn(async (threadId: string) => {
      calls.push(`resume:${threadId}`)
    })
    const replayThreadEvents = vi.fn(async (threadId: string) => {
      calls.push(`replay:${threadId}`)
      return true
    })

    await initializeRuntime({
      initializeHandshake,
      refreshThreads,
      refreshWorkspaceDiff,
      activeThreadIdRef: { current: 'thread-1' },
      resumeThreadInputs,
      replayThreadEvents,
    })

    expect(initializeHandshake).toHaveBeenCalledTimes(1)
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(refreshWorkspaceDiff).toHaveBeenCalledTimes(1)
    expect(resumeThreadInputs).toHaveBeenCalledWith('thread-1')
    expect(replayThreadEvents).toHaveBeenCalledWith('thread-1', { fromStart: true })
    expect(calls).toEqual(['handshake', 'threads', 'diff', 'resume:thread-1', 'replay:thread-1'])
  })

  it('skips resume/replay when there is no active thread', async () => {
    const resumeThreadInputs = vi.fn(async () => {})
    const replayThreadEvents = vi.fn(async () => true)

    await initializeRuntime({
      initializeHandshake: vi.fn(async () => {}),
      refreshThreads: vi.fn(async () => {}),
      refreshWorkspaceDiff: vi.fn(async () => {}),
      activeThreadIdRef: { current: null },
      resumeThreadInputs,
      replayThreadEvents,
    })

    expect(resumeThreadInputs).not.toHaveBeenCalled()
    expect(replayThreadEvents).not.toHaveBeenCalled()
  })

  it('stops initialization when connection guard flips to false', async () => {
    let connected = true
    const initializeHandshake = vi.fn(async () => {
      connected = false
    })
    const refreshThreads = vi.fn(async () => {})
    const refreshWorkspaceDiff = vi.fn(async () => {})
    const resumeThreadInputs = vi.fn(async () => {})
    const replayThreadEvents = vi.fn(async () => true)

    await initializeRuntime({
      initializeHandshake,
      refreshThreads,
      refreshWorkspaceDiff,
      activeThreadIdRef: { current: 'thread-1' },
      resumeThreadInputs,
      replayThreadEvents,
      shouldContinue: () => connected,
    })

    expect(initializeHandshake).toHaveBeenCalledTimes(1)
    expect(refreshThreads).not.toHaveBeenCalled()
    expect(refreshWorkspaceDiff).not.toHaveBeenCalled()
    expect(resumeThreadInputs).not.toHaveBeenCalled()
    expect(replayThreadEvents).not.toHaveBeenCalled()
  })
})
