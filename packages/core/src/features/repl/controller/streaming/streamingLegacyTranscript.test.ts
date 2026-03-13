import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { createLegacyTranscriptMutator } from './streamingLegacyTranscript'

describe('createLegacyTranscriptMutator', () => {
  it('applies updates when legacy transcript writes are enabled', () => {
    let messages: Msg[] = []
    const setMessages = vi.fn((next: any) => {
      messages = typeof next === 'function' ? next(messages) : next
    })
    const mutator = createLegacyTranscriptMutator({
      canWriteLegacyTranscript: true,
      setMessages,
    })

    mutator.update((prev) => [
      ...prev,
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: new Date(1) },
    ])

    expect(mutator.canWrite).toBe(true)
    expect(setMessages).toHaveBeenCalledTimes(1)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.content).toBe('hello')
  })

  it('skips updates when legacy transcript writes are disabled', () => {
    const setMessages = vi.fn()
    const mutator = createLegacyTranscriptMutator({
      canWriteLegacyTranscript: false,
      setMessages,
    })

    mutator.update((prev) => prev)

    expect(mutator.canWrite).toBe(false)
    expect(setMessages).not.toHaveBeenCalled()
  })
})

