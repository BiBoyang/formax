import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { EditToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'

describe('EditToolPresenter', () => {
  it('renders a diff preview from old_string/new_string', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Edited a.ts',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'completed',
        input: {
          file_path: 'a.ts',
          old_string: 'const a = 1\nconst b = 2',
          new_string: 'const a = 1\nconst b = 3',
        },
      },
    }

    const { lastFrame } = render(<EditToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Edit')
    expect(frame).toContain('(a.ts)')
    expect(frame).toContain('- const b = 2')
    expect(frame).toContain('+ const b = 3')
  })
})

