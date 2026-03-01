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
  promptProps: null as null | { onDecision: (decision: { kind: string; feedback?: string }) => void },
}))

vi.mock('../runtime/userInputContext', () => ({
  useUserInputManager: () => mocks.userInput,
}))

vi.mock('../../components/tool/fsReadApprovalPrompt', () => ({
  FsReadApprovalPrompt: (props: any) => {
    mocks.promptProps = props
    return <Text>{props.title}</Text>
  },
}))

import { FsReadApprovalToolBlock } from '../../components/tool/FsReadApprovalToolBlock'

describe('FsReadApprovalToolBlock', () => {
  beforeEach(() => {
    mocks.userInput = null
    mocks.promptProps = null
  })

  it('renders nothing when read approval is not pending', () => {
    mocks.userInput = {
      isPending: () => false,
      submitAnswers: vi.fn(),
    }

    const { lastFrame } = render(
      <FsReadApprovalToolBlock toolUseId="t1" title="Read directory" directoryPath="/repo/src" />,
    )
    expect(lastFrame()).toBe('')
  })

  it('renders prompt and maps all decision kinds to submitAnswers', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      isPending: () => true,
      submitAnswers,
    }

    const { lastFrame } = render(
      <FsReadApprovalToolBlock toolUseId="t-read" title="Read directory" directoryPath="/repo/src" />,
    )
    expect(lastFrame()).toContain('Read directory')

    if (!mocks.promptProps) throw new Error('Expected FsReadApprovalPrompt props')
    mocks.promptProps.onDecision({ kind: 'approve' })
    mocks.promptProps.onDecision({ kind: 'approve_remember' })
    mocks.promptProps.onDecision({ kind: 'feedback', feedback: 'please narrow scope' })
    mocks.promptProps.onDecision({ kind: 'cancel' })

    expect(submitAnswers).toHaveBeenNthCalledWith(1, 't-read', { decision: 'approve' })
    expect(submitAnswers).toHaveBeenNthCalledWith(2, 't-read', { decision: 'approve_remember' })
    expect(submitAnswers).toHaveBeenNthCalledWith(3, 't-read', {
      decision: 'feedback',
      feedback: 'please narrow scope',
    })
    expect(submitAnswers).toHaveBeenNthCalledWith(4, 't-read', { decision: 'cancel' })
  })
})
