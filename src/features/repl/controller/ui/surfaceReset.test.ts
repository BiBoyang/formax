import { describe, expect, it } from 'vitest'
import { queueTranscriptSurfaceReset } from './surfaceReset'

describe('queueTranscriptSurfaceReset', () => {
  it('serializes reset operations on a shared queue', async () => {
    let seq = 0
    let clearCallCount = 0
    let waitCallCount = 0
    const order: string[] = []
    let releaseFirstClear: (() => void) | null = null

    const onClearTerminal = (): Promise<void> => {
      clearCallCount += 1
      const callNo = clearCallCount
      order.push(`clear-start-${callNo}`)
      if (callNo === 1) {
        return new Promise<void>((resolve) => {
          releaseFirstClear = () => {
            order.push('clear-end-1')
            resolve()
          }
        })
      }
      order.push(`clear-end-${callNo}`)
      return Promise.resolve()
    }
    const setTranscriptSeq = (updater: number | ((prev: number) => number)): void => {
      seq = typeof updater === 'function' ? updater(seq) : updater
      order.push(`seq-${seq}`)
    }
    const waitForNextMacrotaskFn = async (): Promise<void> => {
      waitCallCount += 1
      order.push(`wait-${waitCallCount}`)
    }
    const surfaceOpQueueRef = { current: Promise.resolve() }

    const first = queueTranscriptSurfaceReset({
      surfaceOpQueueRef,
      onClearTerminal,
      setTranscriptSeq,
      waitForNextMacrotaskFn,
    })
    const second = queueTranscriptSurfaceReset({
      surfaceOpQueueRef,
      onClearTerminal,
      setTranscriptSeq,
      waitForNextMacrotaskFn,
    })

    for (let i = 0; i < 5 && !releaseFirstClear; i += 1) {
      await Promise.resolve()
    }
    expect(releaseFirstClear).not.toBeNull()
    expect(clearCallCount).toBe(1)

    releaseFirstClear?.()
    await first
    await second

    expect(seq).toBe(2)
    expect(clearCallCount).toBe(2)
    expect(waitCallCount).toBe(2)
    expect(order).toEqual([
      'clear-start-1',
      'clear-end-1',
      'seq-1',
      'wait-1',
      'clear-start-2',
      'clear-end-2',
      'seq-2',
      'wait-2',
    ])
  })

  it('continues queue execution after a failed operation', async () => {
    let seq = 0
    let clearCallCount = 0
    const surfaceOpQueueRef = { current: Promise.resolve() }

    const onClearTerminal = (): Promise<void> => {
      clearCallCount += 1
      if (clearCallCount === 1) return Promise.reject(new Error('clear failed'))
      return Promise.resolve()
    }
    const setTranscriptSeq = (updater: number | ((prev: number) => number)): void => {
      seq = typeof updater === 'function' ? updater(seq) : updater
    }

    const first = queueTranscriptSurfaceReset({
      surfaceOpQueueRef,
      onClearTerminal,
      setTranscriptSeq,
      waitForNextMacrotaskFn: async () => {},
    })
    await expect(first).rejects.toThrow('clear failed')

    const second = queueTranscriptSurfaceReset({
      surfaceOpQueueRef,
      onClearTerminal,
      setTranscriptSeq,
      waitForNextMacrotaskFn: async () => {},
    })
    await expect(second).resolves.toBeUndefined()

    expect(clearCallCount).toBe(2)
    expect(seq).toBe(1)
  })
})
