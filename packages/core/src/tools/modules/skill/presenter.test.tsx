import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../shared/toolMessageTypes'
import { UserInputProvider } from '../../runtime/userInputContext'
import { createUserInputManager } from '../../runtime/userInputManager'
import { SkillToolPresenter } from './presenter'

describe('SkillToolPresenter', () => {
  it('falls back to ToolMessage when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'some tool output',
      timestamp: new Date(),
    }

    const { lastFrame } = render(<SkillToolPresenter message={message} />)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('renders Skill(name) and hides tool_result noise on success', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Launching skill: frontend-design\nBase directory for this skill: /tmp\n\n(do stuff)',
      timestamp: new Date(),
      toolInfo: {
        name: 'Skill',
        status: 'completed',
        input: { skill: 'frontend-design' },
      },
    }

    const { lastFrame } = render(<SkillToolPresenter message={message} />)
    const frame = lastFrame()

    expect(frame).toContain('Skill(frontend-design)')
    expect(frame).not.toContain('Launching skill:')
    expect(frame).not.toContain('Base directory for this skill')
  })

  it('shows an approval prompt when running and the tool use is pending', () => {
    const userInput = createUserInputManager()

    const toolUseId = 'pending-1'
    userInput.requestAnswers({
      toolUseId,
      questions: [
        {
          header: 'h',
          question: 'q',
          multiSelect: false,
          options: [{ label: 'ok', description: 'ok' }],
        },
      ],
    }).catch(() => {})

    const message: Msg = {
      id: `tool-${toolUseId}`,
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Skill',
        status: 'running',
        input: { skill: '' },
      },
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <SkillToolPresenter message={message} />
      </UserInputProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Skill(unknown)')
    expect(frame).toContain('Use skill')

    userInput.rejectAllPending(new Error('cleanup'))
  })

  it('renders the error summary when the tool fails', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Error: Unknown skill: nope',
      timestamp: new Date(),
      toolInfo: {
        name: 'Skill',
        status: 'error',
        input: { skill: 'nope' },
      },
    }

    const { lastFrame } = render(<SkillToolPresenter message={message} />)
    const frame = lastFrame()

    expect(frame).toContain('Skill(nope)')
    expect(frame).toContain('Error: Unknown skill: nope')
  })
})
