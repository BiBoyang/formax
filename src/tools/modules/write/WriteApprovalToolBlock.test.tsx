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
  markdownProps: [] as Array<{ markdown: string }>,
  previewProps: [] as Array<{ fileName: string; width: number; remainingLines: number }>,
}))

vi.mock('../../runtime/userInputContext', () => ({
  useUserInputManager: () => mocks.userInput,
}))

vi.mock('../../../components/ui/ApprovalHeader', () => ({
  ApprovalHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
}))

vi.mock('../../presenters/ApprovalPreview', () => ({
  ApprovalPreview: ({
    fileName,
    width,
    remainingLines,
    children,
  }: {
    fileName: string
    width: number
    remainingLines: number
    children: React.ReactNode
  }) => {
    mocks.previewProps.push({ fileName, width, remainingLines })
    return (
      <Text>
        preview:{fileName}:{width}:{remainingLines}
        {children}
      </Text>
    )
  },
}))

vi.mock('../../../components/ui/MarkdownBlock', () => ({
  MarkdownBlock: ({ markdown }: { markdown: string }) => {
    mocks.markdownProps.push({ markdown })
    return <Text>{markdown}</Text>
  },
}))

vi.mock('../../presenters/fsWriteApprovalPrompt', () => ({
  FsWriteApprovalPrompt: (props: any) => {
    mocks.promptProps = props
    return <Text>{props.title}</Text>
  },
}))

import { WriteApprovalToolBlock } from './WriteApprovalToolBlock.js'

describe('WriteApprovalToolBlock', () => {
  beforeEach(() => {
    mocks.userInput = null
    mocks.promptProps = null
    mocks.markdownProps.length = 0
    mocks.previewProps.length = 0
  })

  it('renders nothing when the write request is not pending', () => {
    mocks.userInput = {
      isPending: () => false,
      submitAnswers: vi.fn(),
    }

    const { lastFrame } = render(
      <WriteApprovalToolBlock toolUseId="w1" fileName="new.txt" content="hello" />,
    )
    expect(lastFrame()).toBe('')
  })

  it('builds preview markdown and maps all decisions to submitAnswers', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      isPending: () => true,
      submitAnswers,
    }

    const lines = [
      '```ts',
      'const a = 1',
      ...Array.from({ length: 30 }, (_, i) => `line-${i + 1}`),
    ].join('\n')

    const { lastFrame } = render(
      <WriteApprovalToolBlock toolUseId="w2" fileName="new.txt" content={lines} />,
    )

    const frame = lastFrame()
    expect(frame).toContain('Create file')
    expect(frame).toContain('Do you want to create')
    expect(mocks.previewProps).toHaveLength(1)
    expect(mocks.previewProps[0].fileName).toBe('new.txt')
    expect(mocks.previewProps[0].remainingLines).toBeGreaterThan(0)
    expect(mocks.markdownProps).toHaveLength(1)
    // Odd fence count should be closed in preview.
    expect(mocks.markdownProps[0].markdown.trimEnd().endsWith('```')).toBe(true)

    if (!mocks.promptProps) throw new Error('Expected fs write prompt props')
    mocks.promptProps.onDecision({ kind: 'approve' })
    mocks.promptProps.onDecision({ kind: 'approve_remember' })
    mocks.promptProps.onDecision({ kind: 'feedback', feedback: 'rename file' })
    mocks.promptProps.onDecision({ kind: 'cancel' })

    expect(submitAnswers).toHaveBeenNthCalledWith(1, 'w2', { decision: 'approve' })
    expect(submitAnswers).toHaveBeenNthCalledWith(2, 'w2', { decision: 'approve_remember' })
    expect(submitAnswers).toHaveBeenNthCalledWith(3, 'w2', {
      decision: 'feedback',
      feedback: 'rename file',
    })
    expect(submitAnswers).toHaveBeenNthCalledWith(4, 'w2', { decision: 'cancel' })
  })

  it('handles empty/non-string content and keeps even code fences unchanged', () => {
    mocks.userInput = {
      isPending: () => true,
      submitAnswers: vi.fn(),
    }

    render(
      <WriteApprovalToolBlock
        toolUseId="w3"
        fileName="empty.txt"
        content={null as any}
      />,
    )
    expect(mocks.markdownProps[0]?.markdown).toBe('')

    const evenFenceContent = ['```ts', 'const x = 1', '```'].join('\n')
    render(
      <WriteApprovalToolBlock
        toolUseId="w4"
        fileName="even-fence.txt"
        content={evenFenceContent}
      />,
    )
    const lastMarkdown = mocks.markdownProps[mocks.markdownProps.length - 1]?.markdown ?? ''
    expect(lastMarkdown).toBe(evenFenceContent)
  })
})
