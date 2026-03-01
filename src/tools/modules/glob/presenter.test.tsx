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

vi.mock('../../../components/tool/fsReadApprovalPrompt', () => ({
  FsReadApprovalPrompt: (props: any) => {
    lastPrompt = props
    return <Text>{props.title}</Text>
  },
}))

import { GlobToolPresenter } from './presenter'

function stripAnsi(text: string): string {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '')
}

describe('GlobToolPresenter', () => {
  beforeEach(() => {
    userInput = null
    lastPrompt = null
  })

  it('renders an approval prompt while running + pending and maps decisions to userInput answers', () => {
    const submitAnswers = vi.fn()
    userInput = { isPending: () => true, submitAnswers }

    const message: Msg = {
      id: 'tool-abc',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'Glob', status: 'running', input: { pattern: '*.ts', path: 'src' }, result: '' },
    }

    const view = render(<ToolUiBlocks blocks={GlobToolPresenter({ message }).blocks} />)
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Approve this Search call?')
    expect(lastPrompt).not.toBe(null)
    if (!lastPrompt) throw new Error('Expected FsReadApprovalPrompt to render')

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
      content: 'Found 3 files',
      timestamp: new Date(),
      toolInfo: {
        name: 'Glob',
        status: 'completed',
        input: { pattern: '*.ts', path: 'src' },
        result: '',
        middleLines: ['a', 'b'],
        expandInfo: 'more',
      },
    }

    const view = render(<ToolUiBlocks blocks={GlobToolPresenter({ message }).blocks} />)
    const frame = stripAnsi(view.lastFrame() ?? '')

    expect(frame).toContain('⎿')
    expect(frame).toContain('Found 3 files')
    expect(frame).not.toContain('     a')
    expect(frame).not.toContain('     b')
    expect(frame).not.toContain('     more')
  })

  it('renders unknown header when tool info is missing', () => {
    const message: Msg = {
      id: 'tool-unknown',
      role: 'tool',
      content: '',
      timestamp: new Date(),
    }
    const view = render(<ToolUiBlocks blocks={GlobToolPresenter({ message }).blocks} />)
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Unknown tool')
  })

  it('falls back to cwd and id when running path/toolUseId are missing', () => {
    const message: Msg = {
      id: 'plain-id',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Glob',
        status: 'running',
        input: {},
        result: '',
      },
    }
    const blocks = GlobToolPresenter({ message }).blocks as any[]
    expect(blocks[1].kind).toBe('custom')
    expect(blocks[1].node.props.toolUseId).toBe('plain-id')
    expect(blocks[1].node.props.directoryPath).toBe(process.cwd())
  })

  it('renders compact error details for error results', () => {
    const message: Msg = {
      id: 'tool-error',
      role: 'tool',
      content: 'Error: denied',
      timestamp: new Date(),
      toolInfo: {
        name: 'Glob',
        status: 'error',
        input: { pattern: '*.ts', path: '/tmp' },
        result: '',
        middleLines: ['Path: /tmp'],
        expandInfo: 'Path (absolute): /tmp',
      },
    }
    const view = render(<ToolUiBlocks blocks={GlobToolPresenter({ message }).blocks} />)
    const frame = stripAnsi(view.lastFrame() ?? '')
    expect(frame).toContain('Error: denied')
    expect(frame).toContain('Path: /tmp')
  })

  it('renders error summary without detail lines when compact detail is absent', () => {
    const message: Msg = {
      id: 'tool-error-no-detail',
      role: 'tool',
      content: 'Error: blocked',
      timestamp: new Date(),
      toolInfo: {
        name: 'Glob',
        status: 'error',
        input: { pattern: '*.ts', path: '/tmp' },
        result: '',
      },
    }
    const view = render(<ToolUiBlocks blocks={GlobToolPresenter({ message }).blocks} />)
    const frame = stripAnsi(view.lastFrame() ?? '')
    expect(frame).toContain('Error: blocked')
    expect(frame).not.toContain('Path:')
  })

  it('handles runtime-missing summary safely', () => {
    const message: Msg = {
      id: 'tool-no-summary',
      role: 'tool',
      content: undefined as any,
      timestamp: new Date(),
      toolInfo: {
        name: 'Glob',
        status: 'completed',
        input: { pattern: '*.ts', path: 'src' },
        result: '',
      },
    }
    const view = render(<ToolUiBlocks blocks={GlobToolPresenter({ message }).blocks} />)
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Search')
  })
})
