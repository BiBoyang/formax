import { describe, expect, it } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import { enqueueSurfaceOperation, queueTranscriptSurfaceReplace, queueTranscriptSurfaceReset } from './surfaceReset'

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
    expect(seq).toBe(2)
  })

  it('uses default macrotask waiter when no custom waiter is provided', async () => {
    let seq = 0
    const surfaceOpQueueRef = { current: Promise.resolve() }
    const onClearTerminal = async (): Promise<void> => {}
    const setTranscriptSeq = (updater: number | ((prev: number) => number)): void => {
      seq = typeof updater === 'function' ? updater(seq) : updater
    }

    await queueTranscriptSurfaceReset({
      surfaceOpQueueRef,
      onClearTerminal,
      setTranscriptSeq,
    })

    expect(seq).toBe(1)
  })

  it('runs operation even when previous queue promise is rejected', async () => {
    const surfaceOpQueueRef = { current: Promise.reject(new Error('previous failed')) }
    const op = async () => {}

    await expect(
      enqueueSurfaceOperation({
        surfaceOpQueueRef,
        op,
      }),
    ).resolves.toBeUndefined()
  })

  it('replaces messages inside the same serialized reset transaction', async () => {
    let seq = 0
    let messages: Msg[] = [{ id: 'old', role: 'assistant', content: 'old', timestamp: new Date() }]
    const order: string[] = []
    const surfaceOpQueueRef = { current: Promise.resolve() }

    const setMessages = (updater: Msg[] | ((prev: Msg[]) => Msg[])): void => {
      messages = typeof updater === 'function' ? updater(messages) : updater
      order.push(`messages:${messages.map((m) => m.id).join(',')}`)
    }
    const onClearTerminal = async (): Promise<void> => {
      order.push('clear')
    }
    const setTranscriptSeq = (updater: number | ((prev: number) => number)): void => {
      seq = typeof updater === 'function' ? updater(seq) : updater
      order.push(`seq:${seq}`)
    }

    await queueTranscriptSurfaceReplace({
      surfaceOpQueueRef,
      onClearTerminal,
      setTranscriptSeq,
      setMessages,
      nextMessages: [{ id: 'next', role: 'assistant', content: 'next', timestamp: new Date() }],
      waitForNextMacrotaskFn: async () => {
        order.push('settle')
      },
    })

    expect(messages.map((m) => m.id)).toEqual(['next'])
    expect(seq).toBe(1)
    expect(order).toEqual(['messages:next', 'clear', 'seq:1', 'settle'])
  })

  it('still remounts after replace when terminal clear fails', async () => {
    let seq = 0
    let messages: Msg[] = [{ id: 'old', role: 'assistant', content: 'old', timestamp: new Date() }]
    const order: string[] = []
    const surfaceOpQueueRef = { current: Promise.resolve() }

    const setMessages = (updater: Msg[] | ((prev: Msg[]) => Msg[])): void => {
      messages = typeof updater === 'function' ? updater(messages) : updater
      order.push(`messages:${messages.map((m) => m.id).join(',')}`)
    }
    const onClearTerminal = async (): Promise<void> => {
      order.push('clear')
      throw new Error('clear failed')
    }
    const setTranscriptSeq = (updater: number | ((prev: number) => number)): void => {
      seq = typeof updater === 'function' ? updater(seq) : updater
      order.push(`seq:${seq}`)
    }

    await expect(
      queueTranscriptSurfaceReplace({
        surfaceOpQueueRef,
        onClearTerminal,
        setTranscriptSeq,
        setMessages,
        nextMessages: [{ id: 'next', role: 'assistant', content: 'next', timestamp: new Date() }],
        waitForNextMacrotaskFn: async () => {
          order.push('settle')
        },
      }),
    ).rejects.toThrow('clear failed')

    expect(messages.map((m) => m.id)).toEqual(['next'])
    expect(seq).toBe(1)
    expect(order).toEqual(['messages:next', 'clear', 'seq:1', 'settle'])
  })
})
