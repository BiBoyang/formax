import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ReadToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'

describe('ReadToolPresenter', () => {
  it('renders workspace denial details (middleLines/expandInfo)', () => {
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
          'ErrorCode: FS_PERMISSION',
          'Path: ~/.codex/copy.json',
          'Path (absolute): /Users/david/.codex/copy.json',
          'Hint: Use /permissions to add a directory',
        ],
        expandInfo: 'Workspace roots: ~/Documents/github/formax',
      },
    }

    const { lastFrame } = render(<ReadToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Read(')
    expect(frame).toContain('ErrorCode: FS_PERMISSION')
    expect(frame).toContain('Path (absolute):')
    expect(frame).toContain('Hint:')
    expect(frame).toContain('Workspace roots:')
  })
})

