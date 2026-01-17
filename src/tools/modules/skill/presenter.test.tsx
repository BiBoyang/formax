import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'
import { SkillToolPresenter } from './presenter'

describe('SkillToolPresenter', () => {
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

