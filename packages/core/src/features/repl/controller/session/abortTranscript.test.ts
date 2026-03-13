import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { applyAbortToMessages } from './abortTranscript'

describe('applyAbortToMessages', () => {
  it('marks running tools as error and appends missing tracked running tools', () => {
    const messages: Msg[] = [
      { id: 'u1', role: 'user', content: 'run', timestamp: new Date(1) },
      {
        id: 'tool-ask',
        role: 'tool',
        content: '',
        timestamp: new Date(2),
        toolInfo: {
          name: 'AskUserQuestion',
          toolUseId: 'ask-1',
          input: {},
          status: 'running',
        },
      },
    ]

    const next = applyAbortToMessages({
      messages,
      trackedRunningTools: [
        ['ask-1', 'AskUserQuestion'],
        ['bash-1', 'Bash'],
      ],
      hadInFlightRequest: true,
      now: () => 1000,
    })

    const ask = next.find((message) => message.role === 'tool' && message.toolInfo?.toolUseId === 'ask-1')
    const bash = next.find((message) => message.role === 'tool' && message.toolInfo?.toolUseId === 'bash-1')
    const declined = next.find((message) => message.role === 'assistant' && /declined/i.test(message.content))

    expect(ask?.toolInfo?.status).toBe('error')
    expect(ask?.toolInfo?.result).toContain('Request aborted')
    expect(bash?.toolInfo?.status).toBe('error')
    expect(bash?.content).toContain('Request aborted')
    expect(declined?.content).toContain('User declined to answer questions')
  })

  it('does not append declined assistant message without in-flight request', () => {
    const next = applyAbortToMessages({
      messages: [],
      trackedRunningTools: [['ask-1', 'AskUserQuestion']],
      hadInFlightRequest: false,
      now: () => 2000,
    })

    const declined = next.filter((message) => message.role === 'assistant' && /declined/i.test(message.content))
    expect(declined).toHaveLength(0)
  })

  it('uses Date.now by default and falls back unnamed tracked tools to "Tool"', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(3000)
    try {
      const next = applyAbortToMessages({
        messages: [],
        trackedRunningTools: [['x-1', '']],
        hadInFlightRequest: false,
      })
      const tool = next.find((message) => message.role === 'tool' && message.toolInfo?.toolUseId === 'x-1')
      expect(tool?.toolInfo?.name).toBe('Tool')
      expect(tool?.timestamp.getTime()).toBe(3000)
    } finally {
      nowSpy.mockRestore()
    }
  })
})
