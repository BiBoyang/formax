import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import {
  ToolHeaderLine,
  ToolIndented,
  ToolIndentedLine,
  ToolSubline,
  ToolUiBlocks,
} from '../../components/tool/ToolUiPrimitives'

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

  it('covers pulsing timers and remaining tone/whitespace branches', async () => {
    const intervalCallbacks: Array<() => void> = []
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(((fn: TimerHandler) => {
        intervalCallbacks.push(fn as () => void)
        return 1 as unknown as ReturnType<typeof setInterval>
      }) as typeof setInterval)
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})

    try {
      const pulse = render(<ToolHeaderLine status="running" label="Pulse" pulse />)
      expect(pulse.lastFrame()).toContain('⏺')
      expect(intervalCallbacks).toHaveLength(1)
      intervalCallbacks[0]()
      await new Promise((resolve) => setImmediate(resolve))
      expect(pulse.lastFrame()).toContain('◌')

      pulse.unmount()
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1)

      const emptyChildren = render(
        <ToolSubline status="completed">
          {'   '}
          {'\n'}
        </ToolSubline>,
      )
      expect(emptyChildren.lastFrame()).toContain('⎿')

      const multiChildren = render(
        <ToolSubline status="completed">
          <Text>A</Text>
          <Text>B</Text>
        </ToolSubline>,
      )
      const multiFrame = multiChildren.lastFrame() || ''
      expect(multiFrame).toContain('A')
      expect(multiFrame).toContain('B')

      const errorLine = render(<ToolIndentedLine tone="error" text="E" />)
      expect(errorLine.lastFrame()).toContain('E')

      const defaultIndented = render(
        <ToolIndented>
          <Text>DEF</Text>
        </ToolIndented>,
      )
      expect(defaultIndented.lastFrame()).toContain('DEF')
    } finally {
      setIntervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
    }
  })
})
