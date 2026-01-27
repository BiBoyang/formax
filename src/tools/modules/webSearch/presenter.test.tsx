import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'
import { InputScopeProvider } from '../../../features/repl/inputScopeContext'
import { ReplUiProvider } from '../../../features/repl/replUiContext'
import { UserInputProvider } from '../../runtime/userInputContext'
import type { UserInputManager } from '../../runtime/userInputManager'
import { WebSearchToolPresenter } from './presenter'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function renderWithProviders(args: { message: Msg; userInput?: UserInputManager | null }) {
  const userInput = args.userInput ?? null

  return render(
    <InputScopeProvider>
      <ReplUiProvider abort={() => {}}>
        {userInput ? (
          <UserInputProvider userInput={userInput}>
            <WebSearchToolPresenter message={args.message} />
          </UserInputProvider>
        ) : (
          <WebSearchToolPresenter message={args.message} />
        )}
      </ReplUiProvider>
    </InputScopeProvider>,
  )
}

describe('WebSearchToolPresenter', () => {
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

  it('shows approval prompt with query and submits approve decision', async () => {
    const submitAnswers = vi.fn(() => true)
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers,
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: (toolUseId) => toolUseId === 'ws1',
      clearBufferedAnswers: () => {},
    }

    const message: Msg = {
      id: 'tool-abc',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebSearch', status: 'running', input: { query: 'cats' }, toolUseId: 'ws1' },
    }

    const { stdin, lastFrame } = renderWithProviders({ message, userInput })

    await tick()
    expect(lastFrame()).toContain('Do you want to search for "cats"?')

    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledWith('ws1', { decision: 'approve' })
  })

  it('supports "Yes, remember" and passes the chosen scope', async () => {
    const submitAnswers = vi.fn(() => true)
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers,
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: (toolUseId) => toolUseId === 'ws2',
      clearBufferedAnswers: () => {},
    }

    const message: Msg = {
      id: 'tool-ws2',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebSearch', status: 'running', input: { query: '' }, toolUseId: 'ws2' },
    }

    const { stdin, lastFrame } = renderWithProviders({ message, userInput })

    await tick()
    expect(lastFrame()).toContain('Do you want to search the web?')

    stdin.write('\u001B[Z') // Shift+Tab -> remember row, scope project
    await tick()

    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledWith('ws2', { decision: 'approve_remember', scope: 'project' })
  })

  it('submits feedback', async () => {
    const submitAnswers = vi.fn(() => true)
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers,
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: (toolUseId) => toolUseId === 'ws3',
      clearBufferedAnswers: () => {},
    }

    const message: Msg = {
      id: 'tool-ws3',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebSearch', status: 'running', input: { query: 'dogs' }, toolUseId: 'ws3' },
    }

    const { stdin } = renderWithProviders({ message, userInput })

    await tick()
    stdin.write('3')
    await tick()
    stdin.write('abc')
    await tick()
    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledWith('ws3', { decision: 'feedback', feedback: 'abc' })
  })

  it('esc cancels', async () => {
    const submitAnswers = vi.fn(() => true)
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers,
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: (toolUseId) => toolUseId === 'ws4',
      clearBufferedAnswers: () => {},
    }

    const message: Msg = {
      id: 'tool-ws4',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebSearch', status: 'running', input: { query: 'birds' }, toolUseId: 'ws4' },
    }

    const { stdin } = renderWithProviders({ message, userInput })

    await tick()
    stdin.write('\u001B')
    for (let i = 0; i < 10; i += 1) {
      await tick()
      if (submitAnswers.mock.calls.length > 0) break
    }

    expect(submitAnswers).toHaveBeenCalledWith('ws4', { decision: 'cancel' })
  })

  it('falls back to ToolMessage when not pending', () => {
    const message: Msg = {
      id: 'tool-ws5',
      role: 'tool',
      content: 'Search results',
      timestamp: new Date(),
      toolInfo: { name: 'WebSearch', status: 'completed', input: { query: 'foxes' }, toolUseId: 'ws5' },
    }

    const { lastFrame } = renderWithProviders({ message })
    expect(lastFrame()).toContain('WebSearch')
    expect(lastFrame()).toContain('foxes')
  })

  it('covers error status branch', () => {
    const message: Msg = {
      id: 'tool-ws6',
      role: 'tool',
      content: 'Error: Rate limited',
      timestamp: new Date(),
      toolInfo: { name: 'WebSearch', status: 'error', input: { query: 'owls' }, toolUseId: 'ws6' },
    }

    const { lastFrame } = renderWithProviders({ message })
    expect(lastFrame()).toContain('WebSearch')
    expect(lastFrame()).toContain('Error: Rate limited')
  })
})
