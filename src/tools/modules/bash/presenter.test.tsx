import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { BashToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'

describe('BashToolPresenter', () => {
  it('keeps bash errors compact', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Error: Bash command denied (sudo): privileged command',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'error',
        input: {
          command: 'sudo ls',
        },
        middleLines: ['ErrorCode: POLICY_DENIED', 'Hint: Use a non-privileged command'],
        expandInfo: 'See docs: /permissions',
      },
    }

    const { lastFrame } = render(<BashToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Bash(')
    expect(frame).toContain('Error: Bash command denied')
    expect(frame).not.toContain('ErrorCode:')
    expect(frame).not.toContain('Hint:')
    expect(frame).not.toContain('See docs:')
  })
})
