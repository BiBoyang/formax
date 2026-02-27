import { describe, expect, it } from 'vitest'
import {
  appendAssistantDeltaToMessages,
  createAssistantStreamingMessage,
  createThinkingBlockMessage,
  finalizeAssistantStreamInMessages,
  updateThinkingBlockContent,
} from './streamingTextRows'

describe('streamingTextRows', () => {
  it('creates assistant streaming row and appends delta', () => {
    const first = createAssistantStreamingMessage({
      assistantId: 'assistant-1',
      text: 'hello',
    })
    const next = appendAssistantDeltaToMessages({
      previous: [first],
      assistantId: 'assistant-1',
      text: ' world',
    })
    expect(next[0]?.content).toBe('hello world')
    expect(next[0]?.isStreaming).toBe(true)
  })

  it('finalizes assistant streaming row', () => {
    const first = createAssistantStreamingMessage({
      assistantId: 'assistant-1',
      text: 'hello',
    })
    const next = finalizeAssistantStreamInMessages({
      previous: [first],
      assistantId: 'assistant-1',
    })
    expect(next[0]?.isStreaming).toBe(false)
  })

  it('creates and updates thinking block row', () => {
    const first = createThinkingBlockMessage({
      thinkingId: 'thinking-1',
      text: 'step-1',
    })
    const next = updateThinkingBlockContent({
      previous: [first],
      thinkingId: 'thinking-1',
      text: 'step-1 step-2',
    })
    expect(next[0]?.ui?.kind).toBe('thinking_block')
    expect(next[0]?.content).toBe('step-1 step-2')
  })

  it('leaves rows unchanged when ids do not match', () => {
    const assistant = createAssistantStreamingMessage({
      assistantId: 'assistant-1',
      text: 'hello',
    })
    const afterAppend = appendAssistantDeltaToMessages({
      previous: [assistant],
      assistantId: 'assistant-2',
      text: ' world',
    })
    expect(afterAppend[0]).toBe(assistant)

    const afterFinalize = finalizeAssistantStreamInMessages({
      previous: [assistant],
      assistantId: 'assistant-2',
    })
    expect(afterFinalize[0]).toBe(assistant)

    const thinking = createThinkingBlockMessage({
      thinkingId: 'thinking-1',
      text: 'step-1',
    })
    const afterThinkingUpdate = updateThinkingBlockContent({
      previous: [thinking],
      thinkingId: 'thinking-2',
      text: 'ignored',
    })
    expect(afterThinkingUpdate[0]).toBe(thinking)
  })
})
