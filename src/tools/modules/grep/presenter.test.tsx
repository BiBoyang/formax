import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { GrepToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'

describe('GrepToolPresenter', () => {
  it('renders error details (middleLines/expandInfo)', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Error: Path is outside the workspace',
      timestamp: new Date(),
      toolInfo: {
        name: 'Grep',
        status: 'error',
        input: {
          pattern: 'foo',
          path: '.',
        },
        middleLines: ['ErrorCode: FS_PERMISSION', 'Hint: Use /permissions to add a directory'],
        expandInfo: 'Workspace roots: ~/Documents/github/formax',
      },
    }

    const { lastFrame } = render(<GrepToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Search(')
    expect(frame).toContain('ErrorCode: FS_PERMISSION')
    expect(frame).toContain('Hint:')
    expect(frame).toContain('Workspace roots:')
  })
})
