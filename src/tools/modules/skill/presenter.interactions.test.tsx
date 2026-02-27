import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../shared/toolMessageTypes.js'

type MockUserInput = {
  isPending: (toolUseId: string) => boolean
  submitAnswers: (toolUseId: string, answers: Record<string, string>) => void
}

const mocks = vi.hoisted(() => ({
  userInput: null as MockUserInput | null,
  promptProps: null as null | {
    title: string
    rememberLabel: string
    onDecision: (decision: { kind: string; feedback?: string }) => void
  },
}))

vi.mock('../../../utils/theme', () => ({
  getTheme: () => ({
    error: 'red',
    text: 'white',
    secondaryText: 'gray',
  }),
}))

vi.mock('../../runtime/userInputContext', () => ({
  useUserInputManager: () => mocks.userInput,
}))

vi.mock('../../presenters/fallback', () => ({
  FallbackToolPresenter: () => <Text>fallback</Text>,
}))

vi.mock('../../presenters/ToolUiPrimitives', () => ({
  ToolHeaderLine: ({ label, params }: { label: string; params: string }) => <Text>{`${label}(${params})`}</Text>,
  ToolSubline: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../../presenters/skillApprovalPrompt', () => ({
  SkillApprovalPrompt: (props: any) => {
    mocks.promptProps = props
    return <Text>{props.title}</Text>
  },
}))

import { SkillToolPresenter } from './presenter.js'

describe('SkillToolPresenter interactions', () => {
  beforeEach(() => {
    mocks.userInput = null
    mocks.promptProps = null
  })

  it('maps approval decisions to submitAnswers and derives toolUseId from tool- prefix', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      isPending: () => true,
      submitAnswers,
    }

    const message: Msg = {
      id: 'tool-abc',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Skill',
        status: 'running',
        input: { skill: 'refactor' },
      },
    }

    const { lastFrame } = render(<SkillToolPresenter message={message} />)
    expect(lastFrame()).toContain('Skill(refactor)')
    expect(mocks.promptProps?.title).toBe('Use skill refactor?')
    expect(mocks.promptProps?.rememberLabel).toContain("don't ask again")

    if (!mocks.promptProps) throw new Error('Expected prompt props')
    mocks.promptProps.onDecision({ kind: 'approve' })
    mocks.promptProps.onDecision({ kind: 'approve_remember' })
    mocks.promptProps.onDecision({ kind: 'feedback', feedback: 'need context' })
    mocks.promptProps.onDecision({ kind: 'cancel' })

    expect(submitAnswers).toHaveBeenNthCalledWith(1, 'abc', { decision: 'approve' })
    expect(submitAnswers).toHaveBeenNthCalledWith(2, 'abc', { decision: 'approve_remember' })
    expect(submitAnswers).toHaveBeenNthCalledWith(3, 'abc', {
      decision: 'feedback',
      feedback: 'need context',
    })
    expect(submitAnswers).toHaveBeenNthCalledWith(4, 'abc', { decision: 'cancel' })
  })

  it('uses raw message id when tool- prefix is absent and renders error subline', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      isPending: () => true,
      submitAnswers,
    }

    const message: Msg = {
      id: 'custom-id',
      role: 'tool',
      content: 'failed',
      timestamp: new Date(),
      toolInfo: {
        name: 'Skill',
        status: 'error',
        input: { skill: '' },
      },
    }

    const { lastFrame } = render(<SkillToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Skill(unknown)')
    expect(frame).toContain('failed')
    expect(mocks.promptProps).toBe(null)
    expect(submitAnswers).not.toHaveBeenCalled()
  })
})
