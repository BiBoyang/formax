import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'
import { InputScopeProvider } from '../../../features/repl/inputScopeContext'
import { ReplUiProvider } from '../../../features/repl/replUiContext'
import { UserInputProvider } from '../../runtime/userInputContext'
import type { UserInputManager } from '../../runtime/userInputManager'
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

    const { stdin, lastFrame } = renderWithProviders({ message, userInput })

    await tick()
    expect(lastFrame()).toContain('Do you want to fetch https://example.com?')

    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledWith('wf1', { decision: 'approve' })
  })
})

