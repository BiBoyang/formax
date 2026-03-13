import { describe, expect, it } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { ToolUiBlocks } from './ToolUiBlocks'
import type { ToolUiBlock } from './toolUiBlocksTypes'

describe('ToolUiBlocks', () => {
  it('renders exactly one space after ⏺ in header', () => {
    const blocks: ToolUiBlock[] = [
      { kind: 'header', status: 'completed', label: 'Read', params: 'LICENSE' },
      { kind: 'subline', status: 'completed', text: 'Read 1 lines' },
    ]

    const { lastFrame } = render(<ToolUiBlocks blocks={blocks} />)
    const frame = lastFrame()

    expect(frame).toContain('⏺ Read')
    expect(frame).not.toContain('⏺  Read')
    expect(frame).not.toContain('⏺Read')
  })

  it('renders subline with the Claude-style ⎿ prefix and no double indent', () => {
    const blocks: ToolUiBlock[] = [
      { kind: 'header', status: 'completed', label: 'Read', params: 'LICENSE' },
      {
        kind: 'subline',
        status: 'completed',
        children: (
          <>
            <Text>Read </Text>
            <Text bold>3</Text>
            <Text> lines</Text>
          </>
        ),
      },
    ]

    const { lastFrame } = render(<ToolUiBlocks blocks={blocks} />)
    const frame = lastFrame()

    expect(frame).toContain('  ⎿  ')
    expect(frame).not.toContain('    ⎿  ')
  })
})
