import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'

type MockUserInput = {
  isPending: (toolUseId: string) => boolean
  submitAnswers: (toolUseId: string, answers: Record<string, string>) => void
}

const mocks = vi.hoisted(() => ({
  userInput: null as MockUserInput | null,
  promptProps: null as null | {
    title: string
    command: string
    cwd: string
    onDecision: (decision: { kind: string; feedback?: string }) => void
  },
}))

vi.mock('../runtime/userInputContext', () => ({
  useUserInputManager: () => mocks.userInput,
}))

vi.mock('../../components/tool/bashApprovalPrompt', () => ({
  BashApprovalPrompt: (props: any) => {
    mocks.promptProps = props
    return <Text>{props.title}</Text>
  },
}))

import { BashApprovalToolBlock } from './BashApprovalToolBlock.js'

describe('BashApprovalToolBlock', () => {
  beforeEach(() => {
    mocks.userInput = null
    mocks.promptProps = null
  })

  it('renders nothing when user input manager is unavailable or not pending', () => {
    let view = render(
      <BashApprovalToolBlock toolUseId="t1" title="Approve?" command="ls" cwd="/repo" />,
    )
    expect(view.lastFrame()).toBe('')

    mocks.userInput = {
      isPending: () => false,
      submitAnswers: vi.fn(),
    }
    view = render(
      <BashApprovalToolBlock toolUseId="t1" title="Approve?" command="ls" cwd="/repo" />,
    )
    expect(view.lastFrame()).toBe('')
  })

  it('renders prompt and maps all decision kinds to submitAnswers payloads', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      isPending: () => true,
      submitAnswers,
    }

    const { lastFrame } = render(
      <BashApprovalToolBlock toolUseId="t-approve" title="Approve command?" command="git status" cwd="/repo" />,
    )

    expect(lastFrame()).toContain('Approve command?')
    expect(mocks.promptProps).not.toBe(null)
    if (!mocks.promptProps) throw new Error('Expected prompt props')

    mocks.promptProps.onDecision({ kind: 'approve' })
    mocks.promptProps.onDecision({ kind: 'approve_remember' })
    mocks.promptProps.onDecision({ kind: 'feedback', feedback: 'please add -n' })
    mocks.promptProps.onDecision({ kind: 'cancel' })

    expect(submitAnswers).toHaveBeenNthCalledWith(1, 't-approve', { decision: 'approve' })
    expect(submitAnswers).toHaveBeenNthCalledWith(2, 't-approve', { decision: 'approve_remember' })
    expect(submitAnswers).toHaveBeenNthCalledWith(3, 't-approve', {
      decision: 'feedback',
      feedback: 'please add -n',
    })
    expect(submitAnswers).toHaveBeenNthCalledWith(4, 't-approve', { decision: 'cancel' })
  })
})
