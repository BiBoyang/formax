import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'

type MockUserInput = {
  isPending: (toolUseId: string) => boolean
  submitAnswers: (toolUseId: string, answers: Record<string, string>) => void
}

const mocks = vi.hoisted(() => ({
  userInput: null as MockUserInput | null,
  promptProps: null as null | {
    onDecision: (decision: { kind: string; feedback?: string }) => void
  },
}))

vi.mock('../../runtime/userInputContext', () => ({
  useUserInputManager: () => mocks.userInput,
}))

vi.mock('../../presenters/skillApprovalPrompt', () => ({
  SkillApprovalPrompt: (props: any) => {
    mocks.promptProps = props
    return <Text>{props.title}</Text>
  },
}))

import { SkillToolPresenter } from './presenter'

describe('SkillToolPresenter decisions', () => {
  beforeEach(() => {
    mocks.userInput = null
    mocks.promptProps = null
  })

  it('maps all approval decisions to user input answers', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      isPending: () => true,
      submitAnswers,
    }

    const message: Msg = {
      id: 'tool-s1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Skill',
        status: 'running',
        input: { skill: 'frontend-design' },
      },
    }

    const { lastFrame } = render(<SkillToolPresenter message={message} />)
    expect(lastFrame()).toContain('Use skill frontend-design?')
    if (!mocks.promptProps) throw new Error('Expected SkillApprovalPrompt to render')

    mocks.promptProps.onDecision({ kind: 'approve' })
    mocks.promptProps.onDecision({ kind: 'approve_remember' })
    mocks.promptProps.onDecision({ kind: 'feedback', feedback: 'not now' })
    mocks.promptProps.onDecision({ kind: 'cancel' })

    expect(submitAnswers).toHaveBeenNthCalledWith(1, 's1', { decision: 'approve' })
    expect(submitAnswers).toHaveBeenNthCalledWith(2, 's1', { decision: 'approve_remember' })
    expect(submitAnswers).toHaveBeenNthCalledWith(3, 's1', { decision: 'feedback', feedback: 'not now' })
    expect(submitAnswers).toHaveBeenNthCalledWith(4, 's1', { decision: 'cancel' })
  })

  it('uses raw message id when toolUseId is missing and id has no tool- prefix', () => {
    const isPending = vi.fn(() => true)
    mocks.userInput = {
      isPending,
      submitAnswers: vi.fn(),
    }
    const message: Msg = {
      id: 'plain-id',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Skill',
        status: 'running',
        input: { skill: 'docs' },
      },
    }

    render(<SkillToolPresenter message={message} />)
    expect(isPending).toHaveBeenCalledWith('plain-id')
  })
})
