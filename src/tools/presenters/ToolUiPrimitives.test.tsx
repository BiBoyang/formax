import React from 'react'
import { describe, expect, it } from 'vitest'
import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import {
  ToolHeaderLine,
  ToolIndented,
  ToolIndentedLine,
  ToolSubline,
  ToolUiBlocks,
} from './ToolUiPrimitives'

describe('ToolUiPrimitives', () => {
  it('renders header line with suffix/params and pulsing running status', () => {
    const ui = render(
      <ToolHeaderLine status="running" label="Run" suffix="suf" params="p=1" />,
    )
    expect(ui.lastFrame()).toContain('⏺')
    expect(ui.lastFrame()).toContain('Run')
    expect(ui.lastFrame()).toContain('(suf)')
    expect(ui.lastFrame()).toContain('(p=1)')
  })

  it('renders error/completed header with non-pulsing dot', () => {
    const err = render(<ToolHeaderLine status="error" label="Err" pulse={false} />)
    expect(err.lastFrame()).toContain('⏺')
    expect(err.lastFrame()).toContain('Err')

    const ok = render(
      <ToolHeaderLine status="completed" label="Done" labelBold={false} />,
    )
    expect(ok.lastFrame()).toContain('Done')
  })

  it('renders subline text and strips whitespace-only children nodes', () => {
    const withText = render(<ToolSubline status="completed" text="hello" />)
    expect(withText.lastFrame()).toContain('hello')

    const withErrorText = render(<ToolSubline status="error" text="boom" />)
    expect(withErrorText.lastFrame()).toContain('boom')

    const withChildren = render(
      <ToolSubline status="error">
        {'   '}
        <Text>child</Text>
        {'  '}
      </ToolSubline>,
    )
    expect(withChildren.lastFrame()).toContain('child')
  })

  it('renders indented primitives for default/muted/error tones', () => {
    const line = render(<ToolIndentedLine tone="default" text="A" />)
    expect(line.lastFrame()).toContain('A')

    const muted = render(<ToolIndentedLine tone="muted" text="B" />)
    expect(muted.lastFrame()).toContain('B')

    const error = render(
      <ToolIndented tone="error">
        {' '}
        <Text>C</Text>
      </ToolIndented>,
    )
    expect(error.lastFrame()).toContain('C')

    const mutedIndented = render(
      <ToolIndented tone="muted">
        <Text>D</Text>
      </ToolIndented>,
    )
    expect(mutedIndented.lastFrame()).toContain('D')
  })

  it('renders all ToolUiBlocks kinds and supports empty blocks', () => {
    const empty = render(<ToolUiBlocks blocks={[]} />)
    expect((empty.lastFrame() || '').trim()).toBe('')

    const ui = render(
      <ToolUiBlocks
        headerSuffix="hdr"
        blocks={[
          { kind: 'header', status: 'running', label: 'H', params: 'x' },
          { kind: 'header', status: 'completed', label: 'H2' } as any,
          { kind: 'subline', status: 'completed', text: 'S' },
          { kind: 'lines', lines: [{ text: 'L1' }, { text: 'L2', tone: 'muted' }] },
          { kind: 'custom', node: <Box><Text>N</Text></Box> },
        ]}
      />,
    )
    const frame = ui.lastFrame()
    expect(frame).toContain('H')
    expect(frame).toContain('H2')
    expect(frame).toContain('S')
    expect(frame).toContain('L1')
    expect(frame).toContain('L2')
    expect(frame).toContain('N')
  })
})
