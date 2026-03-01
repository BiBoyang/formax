import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ReadToolPresenter } from './presenter'
import type { Msg } from '../../../shared/toolMessageTypes'
import path from 'node:path'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'
import { isToolBlocksPresenter } from '../../../shared/toolPresenterContracts'

function getBlocks(message: Msg) {
  if (!isToolBlocksPresenter(ReadToolPresenter)) {
    throw new Error('ReadToolPresenter expected to be a blocks presenter')
  }
  return ReadToolPresenter({ message }).blocks
}

describe('ReadToolPresenter', () => {
  it('renders unknown header when tool info is missing', () => {
    const message: Msg = {
      id: 'tool-unknown',
      role: 'tool',
      content: '',
      timestamp: new Date(),
    }
    const { lastFrame } = render(<ToolUiBlocks blocks={ReadToolPresenter({ message }).blocks} />)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('keeps read errors compact', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Error: Path is outside the workspace',
      timestamp: new Date(),
      toolInfo: {
        name: 'Read',
        status: 'error',
        input: {
          file_path: '/Users/david/.codex/copy.json',
        },
        middleLines: [
          'Path: ~/.codex/copy.json',
          'Path (absolute): /Users/david/.codex/copy.json',
        ],
        expandInfo: 'Workspace roots: ~/Documents/github/formax',
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={ReadToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('Read(')
    expect(frame).not.toContain('Workspace roots:')
    expect(frame).toContain('Path: ~/.codex/copy.json')
    expect(frame).not.toContain('Path (absolute):')
  })

  it('shows project-relative paths for in-project absolute file paths', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Read 1 lines',
      timestamp: new Date(),
      toolInfo: {
        name: 'Read',
        status: 'completed',
        input: {
          file_path: path.join(process.cwd(), 'README.md'),
        },
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={ReadToolPresenter({ message }).blocks} />)
    expect(lastFrame()).toContain('Read(README.md)')
  })

  it('renders approval block while read is running', () => {
    const message: Msg = {
      id: 'tool-2',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Read',
        status: 'running',
        input: {
          file_path: path.join(process.cwd(), 'src/index.ts'),
        },
      },
    }
    const { lastFrame } = render(<ToolUiBlocks blocks={ReadToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('Read(')
  })

  it('uses explicit toolUseId and path input for running state block props', () => {
    const message: Msg = {
      id: 'tool-fallback-id',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        toolUseId: 'tu-123',
        name: 'Read',
        status: 'running',
        input: {
          path: path.join(process.cwd(), 'docs/guide.md'),
        },
      },
    }
    const blocks = getBlocks(message)
    const custom = blocks[1] as any
    expect(custom.kind).toBe('custom')
    expect(custom.node.props.toolUseId).toBe('tu-123')
    expect(custom.node.props.directoryPath).toBe(path.join(process.cwd(), 'docs'))
  })

  it('falls back to cwd when running input has no file path fields', () => {
    const message: Msg = {
      id: 'non-tool-prefix-id',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Read',
        status: 'running',
        input: {},
      },
    }
    const blocks = getBlocks(message)
    const header = blocks[0] as any
    const custom = blocks[1] as any
    expect(header.params).toBeNull()
    expect(custom.node.props.toolUseId).toBe('non-tool-prefix-id')
    expect(custom.node.props.directoryPath).toBe(path.dirname(process.cwd()))
  })

  it('renders non-matching summary and includes middle/expand lines on success', () => {
    const message: Msg = {
      id: 'tool-3',
      role: 'tool',
      content: 'Read finished',
      timestamp: new Date(),
      toolInfo: {
        name: 'Read',
        status: 'completed',
        input: { file_path: path.join(process.cwd(), 'a.txt') },
        middleLines: ['line one', 'line two'],
        expandInfo: 'extra detail',
      },
    }
    const { lastFrame } = render(<ToolUiBlocks blocks={getBlocks(message)} />)
    const frame = lastFrame()
    expect(frame).toContain('Read finished')
    expect(frame).toContain('line one')
    expect(frame).toContain('line two')
    expect(frame).toContain('extra detail')
  })

  it('keeps error output compact when no compact detail is available', () => {
    const message: Msg = {
      id: 'tool-4',
      role: 'tool',
      content: 'Error: failed',
      timestamp: new Date(),
      toolInfo: {
        name: 'Read',
        status: 'error',
        input: { file_path: path.join(process.cwd(), 'x.txt') },
      },
    }
    const blocks = getBlocks(message)
    expect(blocks).toHaveLength(2)
    const { lastFrame } = render(<ToolUiBlocks blocks={blocks} />)
    expect(lastFrame()).toContain('Error: failed')
  })

  it('handles missing summary content at runtime', () => {
    const message = {
      id: 'tool-5',
      role: 'tool',
      timestamp: new Date(),
      toolInfo: {
        name: 'Read',
        status: 'completed',
        input: { file_path: path.join(process.cwd(), 'z.txt') },
      },
    } as Msg
    ;(message as any).content = undefined
    const { lastFrame } = render(<ToolUiBlocks blocks={getBlocks(message)} />)
    expect(lastFrame()).toContain('Read(')
  })
})
