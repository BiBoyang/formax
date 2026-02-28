import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'
import { InputScopeProvider } from '../../../features/repl/inputScopeContext'
import { ReplUiProvider } from '../../../features/repl/replUiContext'
import { UserInputProvider } from '../../runtime/userInputContext'
import type { UserInputManager } from '../../runtime/userInputManager'

let promptProps: null | { title: string; onDecision: (d: any) => void } = null

vi.mock('../../presenters/editApprovalPrompt', () => ({
  EditApprovalPrompt: (props: any) => {
    promptProps = props
    return <Text>{props.title}</Text>
  },
}))

import { WebFetchToolPresenter } from './presenter'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

function renderWithProviders(args: { message: Msg; userInput?: UserInputManager | null }) {
  const userInput = args.userInput ?? null

  return render(
    <InputScopeProvider>
      <ReplUiProvider abort={() => {}}>
        {userInput ? (
          <UserInputProvider userInput={userInput}>
            <WebFetchToolPresenter message={args.message} />
          </UserInputProvider>
        ) : (
          <WebFetchToolPresenter message={args.message} />
        )}
      </ReplUiProvider>
    </InputScopeProvider>,
  )
}

describe('WebFetchToolPresenter', () => {
  beforeEach(() => {
    promptProps = null
  })

  it('falls back when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'OK',
      timestamp: new Date(),
    }

    const { lastFrame } = renderWithProviders({ message })
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('shows approval prompt with url and submits approve decision', async () => {
    const submitAnswers = vi.fn(() => true)
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers,
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: (toolUseId) => toolUseId === 'wf1',
      clearBufferedAnswers: () => {},
    }

    const message: Msg = {
      id: 'tool-abc',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebFetch', status: 'running', input: { url: 'https://example.com' }, toolUseId: 'wf1' },
    }

    const { lastFrame } = renderWithProviders({ message, userInput })

    await tick()
    expect(lastFrame()).toContain('Do you want to fetch https://example.com?')
    if (!promptProps) throw new Error('Expected EditApprovalPrompt to render')
    promptProps.onDecision({ kind: 'approve' })
    promptProps.onDecision({ kind: 'approve_remember', scope: 'session' })
    promptProps.onDecision({ kind: 'feedback', feedback: 'no' })
    promptProps.onDecision({ kind: 'cancel' })

    expect(submitAnswers).toHaveBeenCalledWith('wf1', { decision: 'approve' })
    expect(submitAnswers).toHaveBeenCalledWith('wf1', { decision: 'approve_remember', scope: 'session' })
    expect(submitAnswers).toHaveBeenCalledWith('wf1', { decision: 'feedback', feedback: 'no' })
    expect(submitAnswers).toHaveBeenCalledWith('wf1', { decision: 'cancel' })
  })

  it('falls back title when url is missing', async () => {
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers: vi.fn(() => true),
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: (toolUseId) => toolUseId === 'wf2',
      clearBufferedAnswers: () => {},
    }

    const message: Msg = {
      id: 'tool-wf2',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebFetch', status: 'running', input: {}, toolUseId: 'wf2' },
    }

    const { lastFrame } = renderWithProviders({ message, userInput })
    await tick()
    expect(lastFrame()).toContain('Do you want to fetch this URL?')
  })

  it('falls back to default tool renderer when not running or not pending', async () => {
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers: vi.fn(() => true),
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: () => false,
      clearBufferedAnswers: () => {},
    }
    const message: Msg = {
      id: 'tool-wf3',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebFetch', status: 'completed', input: { url: 'https://example.com' }, toolUseId: 'wf3' },
    }
    const { lastFrame } = renderWithProviders({ message, userInput })
    await tick()
    expect(lastFrame()).toContain('WebFetch')
  })

  it('uses raw message id when toolUseId is missing and id has no tool- prefix', async () => {
    const submitAnswers = vi.fn(() => true)
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers,
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: (toolUseId) => toolUseId === 'plain-wf',
      clearBufferedAnswers: () => {},
    }

    const message: Msg = {
      id: 'plain-wf',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebFetch', status: 'running', input: { url: 'https://example.com' } },
    }
    const { lastFrame } = renderWithProviders({ message, userInput })
    await tick()
    expect(lastFrame()).toContain('Do you want to fetch https://example.com?')
    if (!promptProps) throw new Error('Expected EditApprovalPrompt to render')
    promptProps.onDecision({ kind: 'approve' })
    expect(submitAnswers).toHaveBeenCalledWith('plain-wf', { decision: 'approve' })
  })

  it('derives toolUseId from tool- prefixed message id when toolUseId is missing', async () => {
    const isPending = vi.fn((toolUseId: string) => toolUseId === 'derived')
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers: vi.fn(() => true),
      reject: () => true,
      rejectAllPending: () => 0,
      isPending,
      clearBufferedAnswers: () => {},
    }

    const message: Msg = {
      id: 'tool-derived',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebFetch', status: 'running', input: { url: 'https://example.com' } },
    }
    const { lastFrame } = renderWithProviders({ message, userInput })
    await tick()
    expect(lastFrame()).toContain('Do you want to fetch https://example.com?')
    expect(isPending).toHaveBeenCalledWith('derived')
  })
})
