import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { BashToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'

describe('BashToolPresenter', () => {
  it('renders policy deny details (middleLines/expandInfo)', () => {
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
    expect(frame).toContain('ErrorCode: POLICY_DENIED')
    expect(frame).toContain('Hint:')
    expect(frame).toContain('See docs:')
  })
})

