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
  patchCalls: [] as Array<{ filePath: string; oldText: string; newText: string }>,
}))

vi.mock('../../tools/runtime/userInputContext', () => ({
  useUserInputManager: () => mocks.userInput,
}))

vi.mock('../ui/ApprovalHeader', () => ({
  ApprovalHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
}))

vi.mock('./PatchApprovalPreview', () => ({
  PatchApprovalPreview: (props: { filePath: string; oldText: string; newText: string }) => {
    mocks.patchCalls.push(props)
    return <Text>{`patch:${props.filePath}`}</Text>
  },
}))

vi.mock('./fsWriteApprovalPrompt', () => ({
  FsWriteApprovalPrompt: (props: any) => {
    mocks.promptProps = props
    return <Text>{props.title}</Text>
  },
}))

import { EditApprovalToolBlock } from './EditApprovalToolBlock.js'

describe('EditApprovalToolBlock', () => {
  beforeEach(() => {
    mocks.userInput = null
    mocks.promptProps = null
    mocks.patchCalls.length = 0
  })

  it('renders nothing when the edit request is not pending', () => {
    mocks.userInput = {
      isPending: () => false,
      submitAnswers: vi.fn(),
    }

    const { lastFrame } = render(
      <EditApprovalToolBlock
        toolUseId="t1"
        fileName="a.ts"
        filePath="/repo/a.ts"
        oldText="a"
        newText="b"
      />,
    )

    expect(lastFrame()).toBe('')
  })

  it('renders header/preview and maps all decision kinds to submitAnswers', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      isPending: () => true,
      submitAnswers,
    }

    const { lastFrame } = render(
      <EditApprovalToolBlock
        toolUseId="t-edit"
        fileName="a.ts"
        filePath="/repo/a.ts"
        oldText="const a = 1"
        newText="const a = 2"
      />,
    )

    const frame = lastFrame()
    expect(frame).toContain('Edit file a.ts')
    expect(frame).toContain('patch:/repo/a.ts')
    expect(frame).toContain('Do you want to make this edit to')
    expect(mocks.patchCalls).toHaveLength(1)

    if (!mocks.promptProps) throw new Error('Expected prompt props')
    mocks.promptProps.onDecision({ kind: 'approve' })
    mocks.promptProps.onDecision({ kind: 'approve_remember' })
    mocks.promptProps.onDecision({ kind: 'feedback', feedback: 'please keep comment' })
    mocks.promptProps.onDecision({ kind: 'cancel' })

    expect(submitAnswers).toHaveBeenNthCalledWith(1, 't-edit', { decision: 'approve' })
    expect(submitAnswers).toHaveBeenNthCalledWith(2, 't-edit', { decision: 'approve_remember' })
    expect(submitAnswers).toHaveBeenNthCalledWith(3, 't-edit', {
      decision: 'feedback',
      feedback: 'please keep comment',
    })
    expect(submitAnswers).toHaveBeenNthCalledWith(4, 't-edit', { decision: 'cancel' })
  })

  it('skips patch preview when old/new text values are non-strings at runtime', () => {
    mocks.userInput = {
      isPending: () => true,
      submitAnswers: vi.fn(),
    }

    render(
      <EditApprovalToolBlock
        toolUseId="t-edit"
        fileName="a.ts"
        filePath="/repo/a.ts"
        oldText={null as any}
        newText={undefined as any}
      />,
    )

    expect(mocks.patchCalls).toHaveLength(0)
  })
})
