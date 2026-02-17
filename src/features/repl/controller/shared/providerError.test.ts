import { describe, expect, it } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import { applyProviderErrorToState } from './providerError'

describe('applyProviderErrorToState', () => {
  it('sets global error and appends command subline row', () => {
    let error: string | null = null
    let messages: Msg[] = []

    const setError = (next: any) => {
      error = typeof next === 'function' ? next(error) : next
    }
    const setMessages = (next: any) => {
      messages = typeof next === 'function' ? next(messages) : next
    }

    applyProviderErrorToState({
      providerError: 'Unsupported provider',
      setError: setError as any,
      setMessages: setMessages as any,
    })

    expect(error).toBe('Unsupported provider')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      ui: { kind: 'command_subline' },
      content: 'Unsupported provider',
    })
  })
})
