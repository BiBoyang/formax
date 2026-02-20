import { describe, expect, it, vi } from 'vitest'
import { createTurnEventCursorState } from '../../../turnEventCursor'
import { createConnectionInitOrchestrator } from './connectionInitOrchestrator'

describe('connectionInitOrchestrator', () => {
  it('resets cursor and runs initialize on connected status', async () => {
    const previousCursor = createTurnEventCursorState(10)
    const eventCursorRef = { current: previousCursor }
    const runInitialize = vi.fn(async ({ shouldContinue }: { shouldContinue: () => boolean }) => {
      expect(shouldContinue()).toBe(true)
    })

    const orchestrator = createConnectionInitOrchestrator({
      seenEventCap: 20,
      eventCursorRef,
      runInitialize,
      captureError: vi.fn(),
      isCurrentClient: () => true,
    })

    orchestrator.onStatus('connected')

    await vi.waitFor(() => {
      expect(runInitialize).toHaveBeenCalledTimes(1)
    })
    expect(eventCursorRef.current).not.toBe(previousCursor)
  })

  it('re-runs initialization after disconnected to connected transition', async () => {
    const eventCursorRef = { current: createTurnEventCursorState(20) }
    const firstShouldContinueRef: { current: (() => boolean) | null } = { current: null }
    let releaseFirstInitialize: () => void = () => undefined
    const firstInitialize = new Promise<void>((resolve) => {
      releaseFirstInitialize = resolve
    })

    const runInitialize = vi
      .fn<(args: { shouldContinue: () => boolean }) => Promise<void>>()
      .mockImplementationOnce(async ({ shouldContinue }) => {
        firstShouldContinueRef.current = shouldContinue
        await firstInitialize
      })
      .mockImplementation(async ({ shouldContinue }) => {
        expect(shouldContinue()).toBe(true)
      })

    const orchestrator = createConnectionInitOrchestrator({
      seenEventCap: 20,
      eventCursorRef,
      runInitialize,
      captureError: vi.fn(),
      isCurrentClient: () => true,
    })

    orchestrator.onStatus('connected')

    await vi.waitFor(() => {
      expect(runInitialize).toHaveBeenCalledTimes(1)
    })

    orchestrator.onStatus('disconnected')
    orchestrator.onStatus('connected')
    expect(firstShouldContinueRef.current).not.toBeNull()
    if (!firstShouldContinueRef.current) {
      throw new Error('expected first initialize shouldContinue callback')
    }
    expect(firstShouldContinueRef.current()).toBe(false)

    releaseFirstInitialize()

    await vi.waitFor(() => {
      expect(runInitialize).toHaveBeenCalledTimes(2)
    })
  })

  it('stops future initialization after dispose', async () => {
    const eventCursorRef = { current: createTurnEventCursorState(20) }
    let releaseInitialize: () => void = () => undefined
    const initialize = new Promise<void>((resolve) => {
      releaseInitialize = resolve
    })
    const runInitialize = vi.fn(async () => {
      await initialize
    })

    const orchestrator = createConnectionInitOrchestrator({
      seenEventCap: 20,
      eventCursorRef,
      runInitialize,
      captureError: vi.fn(),
      isCurrentClient: () => true,
    })

    orchestrator.onStatus('connected')

    await vi.waitFor(() => {
      expect(runInitialize).toHaveBeenCalledTimes(1)
    })

    orchestrator.onStatus('connected')
    orchestrator.dispose()
    releaseInitialize()

    await vi.waitFor(() => {
      expect(runInitialize).toHaveBeenCalledTimes(1)
    })
  })
})
