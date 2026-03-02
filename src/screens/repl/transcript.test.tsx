import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../shared/toolMessageTypes'
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
        transcriptSeq={0}
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
        transcriptSeq={0}
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

  it('renders static mode paths when FORMAX_FORCE_INK_STATIC=1', () => {
    const prev = process.env.FORMAX_FORCE_INK_STATIC
    process.env.FORMAX_FORCE_INK_STATIC = '1'
    try {
      const m1 = msg({ id: 'm1', role: 'assistant', content: 'A' })
      const m2 = msg({ id: 'm2', role: 'assistant', content: 'B' })
      const renderMessage = vi.fn((m: Msg) => <Text>{m.content}</Text>)

      const viewA = render(
        <ReplTranscript
          transcriptSeq={1}
          version="0.0.0"
          modelLabel="Model: test"
          cwd="/tmp"
          staticMessages={[m1]}
          transientMessages={[m2]}
          renderMessage={renderMessage}
        />,
      )
      expect(viewA.lastFrame()).toContain('A')
      expect(viewA.lastFrame()).toContain('B')

      const viewB = render(
        <ExpandedReplTranscript
          transcriptSeq={2}
          version="0.0.0"
          modelLabel="Model: test"
          cwd="/tmp"
          messages={[m1]}
          renderMessage={renderMessage}
        />,
      )
      expect(viewB.lastFrame()).toContain('A')
    } finally {
      if (prev === undefined) delete process.env.FORMAX_FORCE_INK_STATIC
      else process.env.FORMAX_FORCE_INK_STATIC = prev
    }
  })

  it('can enable static mode via NODE_ENV/VITEST gate without FORCE flag', () => {
    const prevForce = process.env.FORMAX_FORCE_INK_STATIC
    const prevNodeEnv = process.env.NODE_ENV
    const prevVitest = process.env.VITEST
    delete process.env.FORMAX_FORCE_INK_STATIC
    process.env.NODE_ENV = 'development'
    delete process.env.VITEST
    try {
      const m1 = msg({ id: 'm1', role: 'assistant', content: 'A' })
      const renderMessage = vi.fn((m: Msg) => <Text>{m.content}</Text>)
      const view = render(
        <ExpandedReplTranscript
          transcriptSeq={3}
          version="0.0.0"
          modelLabel="Model: test"
          cwd="/tmp"
          messages={[m1]}
          renderMessage={renderMessage}
        />,
      )
      expect(view.lastFrame()).toContain('A')
    } finally {
      if (prevForce === undefined) delete process.env.FORMAX_FORCE_INK_STATIC
      else process.env.FORMAX_FORCE_INK_STATIC = prevForce
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevVitest === undefined) delete process.env.VITEST
      else process.env.VITEST = prevVitest
    }
  })
})
