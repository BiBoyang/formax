import { describe, expect, it, vi, beforeEach } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'

let lastPromptProps: null | { title: string; onDecision: (d: any) => void } = null

vi.mock('../../presenters/fsWriteApprovalPrompt', () => ({
  FsWriteApprovalPrompt: (props: any) => {
    lastPromptProps = props
    return <Text>{props.title}</Text>
  },
}))

type MockUserInput = {
  isPending: (toolUseId: string) => boolean
  submitAnswers: (toolUseId: string, answers: unknown) => void
}

let userInput: null | MockUserInput = null

vi.mock('../../runtime/userInputContext', () => ({
  useUserInputManager: () => userInput,
}))

import { NotebookEditToolPresenter } from './presenter'

describe('NotebookEditToolPresenter', () => {
  beforeEach(() => {
    lastPromptProps = null
    userInput = null
  })

  it('falls back when toolInfo is missing', () => {
    const message: Msg = { id: 'tool-1', role: 'tool', content: 'OK', timestamp: new Date() }
    const { lastFrame } = render(<NotebookEditToolPresenter message={message} />)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('renders a normal ToolMessage when not pending approval', async () => {
    userInput = { isPending: () => false, submitAnswers: vi.fn() }
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'NotebookEdit', status: 'completed', input: { notebook_path: '/a/b/n.ipynb' }, result: 'ok' },
    }

    const { lastFrame } = render(<NotebookEditToolPresenter message={message} />)
    expect(lastFrame()).toContain('NotebookEdit')
    expect(lastPromptProps).toBe(null)
  })

  it('renders an approval prompt while running + pending and maps decisions to userInput answers', () => {
    const submitAnswers = vi.fn()
    userInput = { isPending: () => true, submitAnswers }

    const message: Msg = {
      id: 'tool-abc',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'NotebookEdit', status: 'running', input: { notebook_path: '/a/b/n.ipynb' }, result: '' },
    }

    const { lastFrame } = render(<NotebookEditToolPresenter message={message} />)
    expect(lastFrame()).toContain('Do you want to edit n.ipynb?')
    expect(lastPromptProps).not.toBe(null)
    if (!lastPromptProps) throw new Error('Expected FsWriteApprovalPrompt to render')

    lastPromptProps.onDecision({ kind: 'approve' })
    expect(submitAnswers).toHaveBeenLastCalledWith('abc', { decision: 'approve' })

    lastPromptProps.onDecision({ kind: 'approve_remember' })
    expect(submitAnswers).toHaveBeenLastCalledWith('abc', { decision: 'approve_remember' })

    lastPromptProps.onDecision({ kind: 'feedback', feedback: 'no thanks' })
    expect(submitAnswers).toHaveBeenLastCalledWith('abc', { decision: 'feedback', feedback: 'no thanks' })

    lastPromptProps.onDecision({ kind: 'cancel' })
    expect(submitAnswers).toHaveBeenLastCalledWith('abc', { decision: 'cancel' })
  })

  it('prefers toolInfo.toolUseId over message.id when checking pending and submitting answers', () => {
    const isPending = vi.fn(() => true)
    const submitAnswers = vi.fn()
    userInput = { isPending, submitAnswers }

    const message: Msg = {
      id: 'tool-abc',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'NotebookEdit',
        status: 'running',
        toolUseId: 'explicit',
        input: { notebook_path: '' },
        result: '',
      },
    }

    render(<NotebookEditToolPresenter message={message} />)
    expect(isPending).toHaveBeenCalledWith('explicit')

    if (!lastPromptProps) throw new Error('Expected FsWriteApprovalPrompt to render')
    lastPromptProps.onDecision({ kind: 'approve' })
    expect(submitAnswers).toHaveBeenCalledWith('explicit', { decision: 'approve' })
  })

  it('uses raw message.id when it does not have tool- prefix', () => {
    const isPending = vi.fn(() => true)
    const submitAnswers = vi.fn()
    userInput = { isPending, submitAnswers }

    const message: Msg = {
      id: 'plain-id',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'NotebookEdit',
        status: 'running',
        input: { notebook_path: '/tmp/nb.ipynb' },
        result: '',
      },
    }

    render(<NotebookEditToolPresenter message={message} />)
    expect(isPending).toHaveBeenCalledWith('plain-id')

    if (!lastPromptProps) throw new Error('Expected FsWriteApprovalPrompt to render')
    lastPromptProps.onDecision({ kind: 'approve' })
    expect(submitAnswers).toHaveBeenCalledWith('plain-id', { decision: 'approve' })
  })
})
