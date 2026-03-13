import { describe, expect, it } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { ToolRouter } from './ToolRouter'
import type { Msg } from './ToolMessage'
import { ToolRegistry } from '../../tools/registry'
import { createToolBlocksPresenter } from '../../shared/toolPresenterContracts'

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

function withHooksDebug(value: string | undefined, run: () => void) {
  const previous = process.env.FORMAX_HOOKS_DEBUG
  if (value === undefined) {
    delete process.env.FORMAX_HOOKS_DEBUG
  } else {
    process.env.FORMAX_HOOKS_DEBUG = value
  }

  try {
    run()
  } finally {
    if (previous === undefined) {
      delete process.env.FORMAX_HOOKS_DEBUG
    } else {
      process.env.FORMAX_HOOKS_DEBUG = previous
    }
  }
}

describe('ToolRouter', () => {
  it('returns null for non-tool messages', () => {
    const msg = createToolMsg({ role: 'assistant' })
    const { lastFrame } = render(<ToolRouter message={msg} />)
    expect(lastFrame()).toBe('')
  })

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

  it('adds a surface suffix when hooks debug is enabled with toolUseId and message id', () => {
    withHooksDebug('yes', () => {
      const registry = new ToolRegistry()
      registry.register({
        name: 'Search',
        presenter: createToolBlocksPresenter(() => ({
          blocks: [{ kind: 'header', status: 'completed', label: 'Search', params: 'src' }],
        })),
      })

      const msg = createToolMsg({
        id: 'message-5678',
        surfaceHint: 'static',
        toolInfo: {
          name: 'Search',
          toolUseId: 'tool-1234',
          input: { path: 'src' },
          status: 'completed',
        },
      })
      const { lastFrame } = render(<ToolRouter message={msg} registry={registry} />)
      expect(lastFrame()).toContain('static#1234@5678:message-5678')
    })
  })

  it('supports surface suffix without a toolUseId and with blank message id', () => {
    withHooksDebug('1', () => {
      const registry = new ToolRegistry()
      registry.register({
        name: 'Search',
        presenter: createToolBlocksPresenter(() => ({
          blocks: [{ kind: 'header', status: 'completed', label: 'Search', params: 'src' }],
        })),
      })

      const msg = createToolMsg({
        id: '' as any,
        surfaceOwner: 'transient',
        toolInfo: {
          name: 'Search',
          toolUseId: '   ',
          input: { path: 'src' },
          status: 'completed',
        },
      })
      const { lastFrame } = render(<ToolRouter message={msg} registry={registry} />)
      expect(lastFrame()).toContain('(trans)')
    })
  })

  it('supports surface suffix without toolUseId but with message id context', () => {
    withHooksDebug('yes', () => {
      const registry = new ToolRegistry()
      registry.register({
        name: 'Search',
        presenter: createToolBlocksPresenter(() => ({
          blocks: [{ kind: 'header', status: 'completed', label: 'Search', params: 'src' }],
        })),
      })

      const msg = createToolMsg({
        id: 'message-4444',
        surfaceOwner: 'transient',
        toolInfo: {
          name: 'Search',
          toolUseId: '',
          input: { path: 'src' },
          status: 'completed',
        },
      })
      const { lastFrame } = render(<ToolRouter message={msg} registry={registry} />)
      expect(lastFrame()).toContain('(trans@4444:message-4444)')
    })
  })

  it('supports toolUseId suffix when message id is blank', () => {
    withHooksDebug('yes', () => {
      const registry = new ToolRegistry()
      registry.register({
        name: 'Search',
        presenter: createToolBlocksPresenter(() => ({
          blocks: [{ kind: 'header', status: 'completed', label: 'Search', params: 'src' }],
        })),
      })

      const msg = createToolMsg({
        id: '' as any,
        surfaceHint: 'static',
        toolInfo: {
          name: 'Search',
          toolUseId: 'tool-9876',
          input: { path: 'src' },
          status: 'completed',
        },
      })

      const { lastFrame } = render(<ToolRouter message={msg} registry={registry} />)
      expect(lastFrame()).toContain('(static#9876)')
    })
  })

  it('does not append suffix when debug is enabled but no surface hint is set', () => {
    withHooksDebug('true', () => {
      const registry = new ToolRegistry()
      registry.register({
        name: 'Search',
        presenter: createToolBlocksPresenter(() => ({
          blocks: [{ kind: 'header', status: 'completed', label: 'Search', params: 'src' }],
        })),
      })

      const msg = createToolMsg({
        id: '' as any,
        toolInfo: {
          name: 'Search',
          toolUseId: 'tool-1234',
          input: { path: 'src' },
          status: 'completed',
        },
      })
      const { lastFrame } = render(<ToolRouter message={msg} registry={registry} />)
      const frame = lastFrame()
      expect(frame).toContain('⏺ Search')
      expect(frame).not.toContain('static#')
      expect(frame).not.toContain('trans#')
    })
  })
})
