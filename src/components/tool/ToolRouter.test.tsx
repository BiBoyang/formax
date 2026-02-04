import { describe, expect, it } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { ToolRouter } from './ToolRouter'
import type { Msg } from './ToolMessage'
import { ToolRegistry } from '../../tools/registry'
import { createToolBlocksPresenter } from '../../tools/presenters/types'

function createToolMsg(overrides: Partial<Msg> = {}): Msg {
  return {
    id: 'tool-1',
    role: 'tool',
    content: 'Read 1 lines',
    timestamp: new Date(),
    toolInfo: {
      name: 'Read',
      input: { file_path: 'README.md' },
      status: 'completed',
    },
    ...overrides,
  }
}

describe('ToolRouter', () => {
  it('falls back to ToolMessage when no registry provided', () => {
    const msg = createToolMsg()
    const { lastFrame } = render(<ToolRouter message={msg} />)
    expect(lastFrame()).toContain('⏺')
    expect(lastFrame()).toContain('Read')
  })

  it('uses a registered presenter for tool name', () => {
    const registry = new ToolRegistry()

    registry.register({
      name: 'Read',
      presenter: ({ message }) => (
        <Text>
          Custom:{message.toolInfo?.name}:{String(message.toolInfo?.input?.file_path)}
        </Text>
      ),
    })

    const msg = createToolMsg()
    const { lastFrame } = render(<ToolRouter message={msg} registry={registry} />)
    expect(lastFrame()).toContain('Custom:Read:README.md')
  })

  it('supports aliases when resolving presenters', () => {
    const registry = new ToolRegistry()

    registry.register({
      name: 'Read',
      aliases: ['FileRead'],
      presenter: () => <Text>Alias presenter</Text>,
    })

    const msg = createToolMsg({
      toolInfo: { name: 'FileRead', input: { file_path: 'x.ts' }, status: 'completed' },
    })
    const { lastFrame } = render(<ToolRouter message={msg} registry={registry} />)
    expect(lastFrame()).toContain('Alias presenter')
  })

  it('renders blocks presenters via ToolUiBlocks', () => {
    const registry = new ToolRegistry()

    registry.register({
      name: 'Search',
      presenter: createToolBlocksPresenter(() => ({
        blocks: [
          { kind: 'header', status: 'completed', label: 'Search', params: 'src' },
          { kind: 'subline', status: 'completed', text: 'Found 1 files' },
        ],
      })),
    })

    const msg = createToolMsg({
      toolInfo: { name: 'Search', input: { path: 'src' }, status: 'completed' },
      content: 'Found 1 files',
    })
    const { lastFrame } = render(<ToolRouter message={msg} registry={registry} />)
    const frame = lastFrame()

    expect(frame).toContain('⏺ Search')
    expect(frame).toContain('  ⎿  ')
    expect(frame).toContain('Found 1 files')
  })
})
