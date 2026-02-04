import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ReadToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'
import path from 'node:path'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'

describe('ReadToolPresenter', () => {
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
})
