import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'

type MockUserInput = {
  isPending: (toolUseId: string) => boolean
  submitAnswers: (toolUseId: string, answers: unknown) => void
}

let userInput: null | MockUserInput = null
let lastPrompt: null | { title: string; onDecision: (d: any) => void } = null

vi.mock('../../runtime/userInputContext', () => ({
  useUserInputManager: () => userInput,
}))

vi.mock('../../presenters/fsReadApprovalPrompt', () => ({
  FsReadApprovalPrompt: (props: any) => {
    lastPrompt = props
    return <Text>{props.title}</Text>
  },
}))

import { GrepToolPresenter } from './presenter'

function stripAnsi(text: string): string {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '')
}

describe('GrepToolPresenter', () => {
  beforeEach(() => {
    userInput = null
    lastPrompt = null
  })

  it('falls back when toolInfo is missing', () => {
    const message: Msg = { id: 'tool-1', role: 'tool', content: 'OK', timestamp: new Date() }
    const { lastFrame } = render(<ToolUiBlocks blocks={GrepToolPresenter({ message }).blocks} />)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('renders an approval prompt while running + pending and maps decisions to userInput answers', () => {
    const submitAnswers = vi.fn()
    userInput = { isPending: () => true, submitAnswers }

    const message: Msg = {
      id: 'tool-abc',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'Grep', status: 'running', input: { pattern: 'x', path: 'src' }, result: '' },
    }

    const view = render(<ToolUiBlocks blocks={GrepToolPresenter({ message }).blocks} />)
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Approve this Search call?')
    expect(lastPrompt).not.toBe(null)
    if (!lastPrompt) throw new Error('Expected EditApprovalPrompt to render')

    lastPrompt.onDecision({ kind: 'approve' })
    expect(submitAnswers).toHaveBeenLastCalledWith('abc', { decision: 'approve' })

    lastPrompt.onDecision({ kind: 'approve_remember' })
    expect(submitAnswers).toHaveBeenLastCalledWith('abc', { decision: 'approve_remember' })

    lastPrompt.onDecision({ kind: 'feedback', feedback: 'no' })
    expect(submitAnswers).toHaveBeenLastCalledWith('abc', { decision: 'feedback', feedback: 'no' })

    lastPrompt.onDecision({ kind: 'cancel' })
    expect(submitAnswers).toHaveBeenLastCalledWith('abc', { decision: 'cancel' })
  })

  it('renders only the completed summary for search results', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Found 3 matches',
      timestamp: new Date(),
      toolInfo: {
        name: 'Grep',
        status: 'completed',
        input: { pattern: 'x', path: 'src' },
        result: '',
        middleLines: ['a', 'b'],
        expandInfo: 'more',
      },
    }

    const view = render(<ToolUiBlocks blocks={GrepToolPresenter({ message }).blocks} />)
    const frame = stripAnsi(view.lastFrame() ?? '')

    expect(frame).toContain('⎿')
    expect(frame).toContain('Found 3 matches')
    expect(frame).not.toContain('     a')
    expect(frame).not.toContain('     b')
    expect(frame).not.toContain('     more')
  })

  it('shows a compact error detail line when available', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Error: something failed',
      timestamp: new Date(),
      toolInfo: {
        name: 'Grep',
        status: 'error',
        input: { pattern: 'x', path: 'src' },
        result: '',
        middleLines: ['Try "foo"', 'Permission denied'],
        expandInfo: 'Hint: blah',
      },
    }

    const view = render(<ToolUiBlocks blocks={GrepToolPresenter({ message }).blocks} />)
    const frame = stripAnsi(view.lastFrame() ?? '')

    expect(frame).toContain('Error: something failed')
    expect(frame).toContain('Permission denied')
    expect(frame).not.toContain('Try "foo"')
    expect(frame).not.toContain('Hint:')
  })
})
