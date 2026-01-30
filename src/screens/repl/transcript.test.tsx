import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../components/tool/ToolMessage'
import { ExpandedReplTranscript, ReplTranscript } from './transcript'

function msg(overrides: Partial<Msg>): Msg {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    ...overrides,
  }
}

describe('ReplTranscript memoization', () => {
  it('does not re-render unchanged message rows when appending new messages', () => {
    const m1 = msg({ id: 'm1', role: 'assistant', content: 'A' })
    const m2 = msg({ id: 'm2', role: 'assistant', content: 'B' })
    const renderMessage = vi.fn((m: Msg) => <Text>{m.content}</Text>)

    const ui = render(
      <ReplTranscript
        transcriptSeq={0}
        version="0.0.0"
        modelLabel="Model: test"
        cwd="/tmp"
        staticMessages={[m1, m2]}
        transientMessages={[]}
        renderMessage={renderMessage}
      />,
    )

    expect(renderMessage).toHaveBeenCalledTimes(2)
    renderMessage.mockClear()

    const m3 = msg({ id: 'm3', role: 'assistant', content: 'C' })
    ui.rerender(
      <ReplTranscript
        transcriptSeq={0}
        version="0.0.0"
        modelLabel="Model: test"
        cwd="/tmp"
        staticMessages={[m1, m2, m3]}
        transientMessages={[]}
        renderMessage={renderMessage}
      />,
    )

    expect(renderMessage).toHaveBeenCalledTimes(1)
    expect(renderMessage).toHaveBeenCalledWith(m3)
  })

  it('does not re-render unchanged message rows for ExpandedReplTranscript', () => {
    const m1 = msg({ id: 'm1', role: 'assistant', content: 'A' })
    const m2 = msg({ id: 'm2', role: 'assistant', content: 'B' })
    const renderMessage = vi.fn((m: Msg) => <Text>{m.content}</Text>)

    const ui = render(
      <ExpandedReplTranscript
        version="0.0.0"
        modelLabel="Model: test"
        cwd="/tmp"
        messages={[m1, m2]}
        renderMessage={renderMessage}
      />,
    )

    expect(renderMessage).toHaveBeenCalledTimes(2)
    renderMessage.mockClear()

    const m3 = msg({ id: 'm3', role: 'assistant', content: 'C' })
    ui.rerender(
      <ExpandedReplTranscript
        version="0.0.0"
        modelLabel="Model: test"
        cwd="/tmp"
        messages={[m1, m2, m3]}
        renderMessage={renderMessage}
      />,
    )

    expect(renderMessage).toHaveBeenCalledTimes(1)
    expect(renderMessage).toHaveBeenCalledWith(m3)
  })
})
