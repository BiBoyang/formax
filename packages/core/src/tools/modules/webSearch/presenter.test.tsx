import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../shared/toolMessageTypes'
import { InputScopeProvider } from '../../../features/repl/inputScopeContext'
import { ReplUiProvider } from '../../../features/repl/replUiContext'
import { UserInputProvider } from '../../runtime/userInputContext'
import type { UserInputManager } from '../../runtime/userInputManager'
import { InteractivePromptSurfaceProvider } from '../../../components/tool/InteractivePromptSurfaceContext'
import { WebSearchToolPresenter } from './presenter'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

async function waitForText(lastFrame: () => string | undefined, text: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  throw new Error(`Timed out waiting for UI to contain: ${text}\n\nLast frame:\n${lastFrame() || ''}`)
}

function renderWithProviders(args: {
  message: Msg
  userInput?: UserInputManager | null
  surface?: 'legacy-inline' | 'bottom-slot'
}) {
  const userInput = args.userInput ?? null
  const surface = args.surface ?? 'legacy-inline'

  return render(
    <InputScopeProvider>
      <ReplUiProvider abort={() => {}}>
        <InteractivePromptSurfaceProvider surface={surface}>
          {userInput ? (
            <UserInputProvider userInput={userInput}>
              <WebSearchToolPresenter message={args.message} />
            </UserInputProvider>
          ) : (
            <WebSearchToolPresenter message={args.message} />
          )}
        </InteractivePromptSurfaceProvider>
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
    await waitForText(lastFrame, 'remember for project')

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

  it('does not render the inline approval prompt on the bottom-slot surface', async () => {
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers: vi.fn(() => true),
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: (toolUseId) => toolUseId === 'ws-bottom',
      clearBufferedAnswers: () => {},
    }

    const message: Msg = {
      id: 'tool-ws-bottom',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'WebSearch',
        status: 'running',
        input: { query: 'bottom slot' },
        toolUseId: 'ws-bottom',
      },
    }

    const { lastFrame } = renderWithProviders({
      message,
      userInput,
      surface: 'bottom-slot',
    })

    await tick()
    expect(lastFrame()).toContain('WebSearch(query: "bottom slot")')
    expect(lastFrame()).not.toContain('Do you want to search for "bottom slot"?')
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

  it('derives toolUseId from tool- prefixed message id when missing in toolInfo', async () => {
    const submitAnswers = vi.fn(() => true)
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers,
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: (toolUseId) => toolUseId === 'derived',
      clearBufferedAnswers: () => {},
    }
    const message: Msg = {
      id: 'tool-derived',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebSearch', status: 'running', input: { query: 'derived query' } },
    }

    const { stdin, lastFrame } = renderWithProviders({ message, userInput })
    await tick()
    expect(lastFrame()).toContain('Do you want to search for "derived query"?')
    stdin.write('\r')
    await tick()
    expect(submitAnswers).toHaveBeenCalledWith('derived', { decision: 'approve' })
  })

  it('uses raw id when toolUseId is missing and id has no tool- prefix', async () => {
    const isPending = vi.fn((toolUseId: string) => toolUseId === 'plain-id')
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers: vi.fn(() => true),
      reject: () => true,
      rejectAllPending: () => 0,
      isPending,
      clearBufferedAnswers: () => {},
    }
    const message: Msg = {
      id: 'plain-id',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebSearch', status: 'running', input: { query: 'plain query' } },
    }
    const { lastFrame } = renderWithProviders({ message, userInput })
    await tick()
    expect(lastFrame()).toContain('Do you want to search for "plain query"?')
    expect(isPending).toHaveBeenCalledWith('plain-id')
  })

  it('renders running approval prompt with default title when query is empty', async () => {
    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers: vi.fn(() => true),
      reject: () => true,
      rejectAllPending: () => 0,
      isPending: (toolUseId) => toolUseId === 'ws-empty-params',
      clearBufferedAnswers: () => {},
    }
    const message: Msg = {
      id: 'tool-ws-empty-params',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'WebSearch', status: 'running', input: { query: '' }, toolUseId: 'ws-empty-params' },
    }
    const { lastFrame } = renderWithProviders({ message, userInput })
    await tick()
    expect(lastFrame()).toContain('Do you want to search the web?')
  })
})
