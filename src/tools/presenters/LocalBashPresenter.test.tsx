import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { ToolUiBlocks } from '../../components/tool/ToolUiBlocks'
import type { Msg } from '../../components/tool/ToolMessage'
import { LocalBashPresenter } from './LocalBashPresenter'

function renderMessage(message: Msg): string {
  const out = LocalBashPresenter({ message })
  const view = render(<ToolUiBlocks blocks={out.blocks} />)
  return view.lastFrame() ?? ''
}

describe('LocalBashPresenter', () => {
  it('truncates to 3 lines in primary view and shows expand hint', () => {
    const frame = renderMessage({
      id: 'tool-1',
      role: 'tool',
      content: '$ ls',
      timestamp: new Date(),
      toolInfo: {
        name: 'LocalBash',
        input: { command: 'ls' },
        status: 'completed',
        result: '1\n2\n3\n4',
      },
    })

    expect(frame).toContain('! ls')
    expect(frame).toContain('⎿')
    expect(frame).toContain('1')
    expect(frame).toContain('2')
    expect(frame).toContain('3')
    expect(frame).not.toContain('\n4')
    expect(frame).toContain('… +1 lines (ctrl+o to expand)')
  })

  it('shows full output in expanded view', () => {
    const frame = renderMessage({
      id: 'tool-2',
      role: 'tool',
      content: '$ ls',
      timestamp: new Date(),
      toolInfo: {
        name: 'LocalBash',
        input: { command: 'ls' },
        status: 'completed',
        result: '1\n2\n3\n4',
        expanded: true,
      },
    })

    expect(frame).toContain('! ls')
    expect(frame).toContain('4')
    expect(frame).not.toContain('… +')
  })
})
