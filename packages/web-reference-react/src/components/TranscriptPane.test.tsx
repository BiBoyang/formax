import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren, ReactElement } from 'react'
import { I18nProvider } from '../app/i18n/I18nProvider'
import { describe, expect, it, vi } from 'vitest'
import type { TranscriptPaneProps } from './TranscriptPane'
import { formatRpcErrorDetails, TranscriptPane } from './TranscriptPane'
import { shouldStopWheelPropagation } from './scrollBoundary'

function renderWithI18n(ui: ReactElement) {
  return rtlRender(ui, {
    wrapper: ({ children }: PropsWithChildren) => <I18nProvider language="en-US">{children}</I18nProvider>,
  })
}

function installImmediateIdleCallbacks() {
  const originalRic = (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback
  const originalCic = (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback
  const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    callback({
      didTimeout: false,
      timeRemaining: () => 50,
    } as IdleDeadline)
    return 1
  })
  const cancelIdleCallback = vi.fn()

  ;(window as Window & { requestIdleCallback?: (callback: IdleRequestCallback) => number }).requestIdleCallback =
    requestIdleCallback
  ;(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback = cancelIdleCallback

  return () => {
    ;(window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = originalRic
    ;(window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCic
  }
}

function baseProps(overrides: Partial<TranscriptPaneProps> = {}): TranscriptPaneProps {
  return {
    activeThreadId: 'thread-1',
    activeTurnId: null,
    logs: [],
    inputText: '',
    mode: 'normal',
    modelTier: 'sonnet',
    thinkingMode: true,
    thinkingEffort: 'medium',
    thinkingEffortSupported: true,
    connectionStatus: 'connected',
    onInputTextChange: vi.fn(),
    onModeChange: vi.fn(),
    onModelTierChange: vi.fn(),
    onThinkingModeChange: vi.fn(),
    onThinkingEffortChange: vi.fn(),
    onSend: vi.fn((event) => event.preventDefault()),
    onInterrupt: vi.fn(),
    ...overrides,
  }
}

describe('TranscriptPane', () => {
  it('reuses full rpc error serialization for equivalent payload objects', () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify')
    const sharedData = { detail: 'same-data-ref' }

    const fullErrorStringifyCount = () =>
      stringifySpy.mock.calls.filter(([value]) => {
        return (
          typeof value === 'object' &&
          value != null &&
          'at' in value &&
          'method' in value &&
          'message' in value
        )
      }).length

    const first = formatRpcErrorDetails({
      at: '2026-03-05T00:00:00.000Z',
      method: 'turn/start',
      message: 'rpc failed',
      code: -32000,
      data: sharedData,
    })
    const fullCallsAfterFirst = fullErrorStringifyCount()

    const second = formatRpcErrorDetails({
      at: '2026-03-05T00:00:00.000Z',
      method: 'turn/start',
      message: 'rpc failed',
      code: -32000,
      data: sharedData,
    })
    const fullCallsAfterSecond = fullErrorStringifyCount()

    expect(second).toBe(first)
    expect(fullCallsAfterSecond).toBe(fullCallsAfterFirst)
    stringifySpy.mockRestore()
  })

  it('invalidates rpc error details cache when payload object changes', () => {
    const sharedData = { detail: 'before' }
    const first = formatRpcErrorDetails({
      at: '2026-03-05T00:00:00.000Z',
      method: 'turn/start',
      message: 'rpc failed',
      code: -32000,
      data: sharedData,
    })

    sharedData.detail = 'after'
    const second = formatRpcErrorDetails({
      at: '2026-03-05T00:00:00.000Z',
      method: 'turn/start',
      message: 'rpc failed',
      code: -32000,
      data: sharedData,
    })

    expect(second).not.toBe(first)
    expect(JSON.parse(second)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ detail: 'after' }),
      }),
    )
  })

  it('keeps distinct cache entries for undefined and null rpc payload data', () => {
    const withoutData = formatRpcErrorDetails({
      at: '2026-03-05T00:00:00.000Z',
      method: 'turn/start',
      message: 'rpc failed',
      code: -32000,
      data: undefined,
    })
    const withNullData = formatRpcErrorDetails({
      at: '2026-03-05T00:00:00.000Z',
      method: 'turn/start',
      message: 'rpc failed',
      code: -32000,
      data: null,
    })

    expect(withNullData).not.toBe(withoutData)
    expect(JSON.parse(withoutData)).not.toHaveProperty('data')
    expect(JSON.parse(withNullData)).toEqual(
      expect.objectContaining({
        data: null,
      }),
    )
  })

  it('enforces send/interrupt states with active turn semantics', () => {
    const onInputTextChange = vi.fn()
    const onSend = vi.fn((event) => event.preventDefault())
    const onInterrupt = vi.fn()

    const { rerender } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeThreadId: null,
          connectionStatus: 'disconnected',
          inputText: 'hello',
          onInputTextChange,
          onSend,
          onInterrupt,
        })}
      />,
    )

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Interrupt turn' })).not.toBeInTheDocument()

    rerender(
      <TranscriptPane
        {...baseProps({
          activeThreadId: 'thread-1',
          connectionStatus: 'connected',
          inputText: 'hello',
          onInputTextChange,
          onSend,
          onInterrupt,
        })}
      />,
    )

    const sendButton = screen.getByRole('button', { name: 'Send message' })
    expect(sendButton).toBeEnabled()
    fireEvent.submit(sendButton.closest('form')!)
    expect(onSend).toHaveBeenCalledTimes(1)

    rerender(
      <TranscriptPane
        {...baseProps({
          activeThreadId: 'thread-1',
          activeTurnId: 'turn-1',
          connectionStatus: 'connected',
          inputText: 'hello',
          onInputTextChange,
          onSend,
          onInterrupt,
        })}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument()
    const interruptButton = screen.getByRole('button', { name: 'Interrupt turn' })
    expect(interruptButton).toBeEnabled()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
    fireEvent.click(interruptButton)
    expect(onInterrupt).toHaveBeenCalledTimes(1)
  })

  it('renders context meter ring in composer dock when enabled', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeThreadId: 'thread-1',
          connectionStatus: 'connected',
          inputText: 'hello',
          showContextMeter: true,
          activeContextMeter: {
            available: true,
            source: 'usage',
            usedTokens: 21000,
            limitTokens: 100000,
            percentUsed: 21,
            percentRemaining: 79,
            shouldAutoCompact: false,
            label: '21% used (21k/100k, usage)',
            tone: 'normal',
          },
        })}
      />,
    )

    expect(screen.getByTestId('composer-context-meter-ring')).toBeInTheDocument()
  })

  it('renders composer mode as a selectable menu', async () => {
    const onModeChange = vi.fn()
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeThreadId: 'thread-1',
          connectionStatus: 'connected',
          mode: 'normal',
          onModeChange,
        })}
      />,
    )

    const selector = screen.getByRole('button', { name: 'Execution mode' })
    expect(selector).toHaveTextContent('Ask before edits')

    fireEvent.keyDown(selector, { key: 'Enter' })

    expect(await screen.findByRole('menuitem', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Auto' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Ask before edits' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Auto' }))

    expect(onModeChange).toHaveBeenCalledWith('acceptEdits')
  })

  it('renders controlled composer model and thinking selector', async () => {
    const onThinkingModeChange = vi.fn()
    const onThinkingEffortChange = vi.fn()
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeThreadId: 'thread-1',
          connectionStatus: 'connected',
          inputText: 'hello',
          modelTier: 'opus',
          thinkingMode: false,
          thinkingEffort: 'max',
          onThinkingModeChange,
          onThinkingEffortChange,
        })}
      />,
    )

    const selector = screen.getByRole('button', { name: 'Model and thinking mode' })
    expect(selector).toHaveTextContent(/opus.*Thinking off/)

    fireEvent.keyDown(selector, { key: 'Enter' })

    expect(await screen.findByText('Thinking mode')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Thinking on'))
    expect(onThinkingModeChange).toHaveBeenCalledWith(true)

    fireEvent.keyDown(selector, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Max' }))
    expect(await screen.findByText('Thinking effort')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('High'))
    expect(onThinkingEffortChange).toHaveBeenCalledWith('high')
  })

  it('hides effort choices when runtime provider does not support Anthropic effort', async () => {
    const onThinkingEffortChange = vi.fn()
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeThreadId: 'thread-1',
          connectionStatus: 'connected',
          inputText: 'hello',
          modelTier: 'opus',
          thinkingMode: true,
          thinkingEffort: 'max',
          thinkingEffortSupported: false,
          onThinkingEffortChange,
        })}
      />,
    )

    const selector = screen.getByRole('button', { name: 'Model and thinking mode' })
    expect(selector).toHaveTextContent(/opus.*Thinking on/)
    expect(selector).not.toHaveTextContent('Max')

    fireEvent.keyDown(selector, { key: 'Enter' })

    expect(await screen.findByText('Thinking mode')).toBeInTheDocument()
    expect(screen.queryByText('Thinking effort')).toBeNull()
    expect(screen.queryByText('Max')).toBeNull()
    expect(onThinkingEffortChange).not.toHaveBeenCalled()
  })

  it('enables first send on the draft surface only after a project is selected', () => {
    const onSend = vi.fn((event) => event.preventDefault())
    const { rerender } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeThreadId: null,
          surfaceKind: 'newThreadDraft',
          draftCwd: null,
          draftCwdOptions: ['/repo'],
          inputText: 'hello',
          onDraftCwdChange: vi.fn(),
          onSend,
        })}
      />,
    )

    expect(screen.getByTestId('new-thread-draft-surface')).toBeInTheDocument()
    expect(screen.queryByText('Choose a project before sending the first message.')).toBeNull()
    expect(screen.getByPlaceholderText('Choose a project first')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()

    rerender(
      <TranscriptPane
        {...baseProps({
          activeThreadId: null,
          surfaceKind: 'newThreadDraft',
          draftCwd: '/repo',
          draftCwdOptions: ['/repo'],
          inputText: 'hello',
          onDraftCwdChange: vi.fn(),
          onSend,
        })}
      />,
    )

    const input = screen.getByPlaceholderText('Ask for follow-up changes')
    expect(input).toBeEnabled()
    const sendButton = screen.getByRole('button', { name: 'Send message' })
    expect(sendButton).toBeEnabled()
    fireEvent.submit(sendButton.closest('form')!)
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('shows runtime feedback while the draft surface is active', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeThreadId: null,
          surfaceKind: 'newThreadDraft',
          draftCwd: '/repo',
          draftCwdOptions: ['/repo'],
          logs: [{ id: 'warn-1', kind: 'log', level: 'warn', text: 'Please choose a project before starting a new thread' }],
          lastRpcError: {
            at: '2026-03-05T00:00:00.000Z',
            method: 'thread/start',
            message: 'rpc failed',
          },
          onDraftCwdChange: vi.fn(),
        })}
      />,
    )

    expect(screen.getByText('Please choose a project before starting a new thread')).toBeInTheDocument()
    expect(screen.getByText('RPC Error: rpc failed')).toBeInTheDocument()
    expect(screen.getByText('Request failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByText(/"method": "thread\/start"/)).toBeInTheDocument()
  })

  it('copies user messages and assistant group answer text from transcript operations', async () => {
    const writeText = vi.fn(async () => undefined)
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    try {
      renderWithI18n(
        <TranscriptPane
          {...baseProps({
            logs: [
              { id: 'u1', kind: 'message', role: 'user', text: 'make it smaller', turnId: 'turn-1' },
              { id: 'a1', kind: 'message', role: 'assistant', text: 'First answer.', turnId: 'turn-1' },
              { id: 'a2', kind: 'message', role: 'assistant', text: 'Second answer.', turnId: 'turn-1' },
            ],
          })}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Copy user message' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('make it smaller'))

      fireEvent.click(screen.getByRole('button', { name: 'Copy assistant message' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('First answer.\n\nSecond answer.'))
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard)
      } else {
        Reflect.deleteProperty(navigator, 'clipboard')
      }
    }
  })

  it('keeps user message operations out of layout flow', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs: [
            { id: 'u1', kind: 'message', role: 'user', text: 'make it smaller', turnId: 'turn-1' },
          ],
        })}
      />,
    )

    const copyButton = screen.getByRole('button', { name: 'Copy user message' })
    expect(copyButton.parentElement).toHaveClass('absolute')
  })

  it('renders assistant markdown into structured content', async () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs: [{ id: 'm1', kind: 'message', role: 'assistant', text: '# Plan\n\n- first item\n- second item' }],
        })}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument()
    })
    expect(screen.getByText('first item')).toBeInTheDocument()
    expect(screen.getByText('second item')).toBeInTheDocument()
  })

  it('hides composer when composerLocked is true and restores when false', () => {
    const { rerender } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          composerLocked: true,
        })}
      />,
    )

    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
    expect(screen.getByTestId('composer-locked')).toBeInTheDocument()

    rerender(
      <TranscriptPane
        {...baseProps({
          composerLocked: false,
        })}
      />,
    )

    expect(screen.getByTestId('composer')).toBeInTheDocument()
    expect(screen.queryByTestId('composer-locked')).not.toBeInTheDocument()
  })

  it('cycles mode with Shift+Tab in composer input', () => {
    const onModeChange = vi.fn()
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          mode: 'normal',
          onModeChange,
        })}
      />,
    )

    const input = screen.getByPlaceholderText('Ask for follow-up changes')
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })

    expect(onModeChange).toHaveBeenCalledWith('acceptEdits')
  })

  it('shows slash command menu when composer input starts with slash', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          inputText: '/',
        })}
      />,
    )

    expect(screen.queryByTestId('composer-slash-menu')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Insert /init' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Insert /clear' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Insert /compact' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Insert /todos' })).not.toBeNull()
  })

  it('filters slash command menu by typed command token', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          inputText: '/co',
        })}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Insert /compact' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Insert /clear' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Insert /init' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Insert /todos' })).toBeNull()
  })

  it('does not render the slash command quick button', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          inputText: '',
        })}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Open slash commands' })).toBeNull()
    expect(screen.queryByTestId('composer-slash-trigger')).toBeNull()
  })

  it('closes auto-open slash menu after selecting a slash command', () => {
    const onInputTextChange = vi.fn()
    const { rerender } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          inputText: '/to',
          onInputTextChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Insert /todos' }))
    expect(onInputTextChange).toHaveBeenCalledWith('/todos ')

    rerender(
      <TranscriptPane
        {...baseProps({
          inputText: '/todos ',
          onInputTextChange,
        })}
      />,
    )

    expect(screen.queryByTestId('composer-slash-menu')).toBeNull()
  })

  it('keeps slash menu suppressed after selection when input has leading spaces', () => {
    const onInputTextChange = vi.fn()
    const { rerender } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          inputText: '   /to',
          onInputTextChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Insert /todos' }))
    expect(onInputTextChange).toHaveBeenCalledWith('   /todos ')

    rerender(
      <TranscriptPane
        {...baseProps({
          inputText: '   /todos ',
          onInputTextChange,
        })}
      />,
    )

    expect(screen.queryByTestId('composer-slash-menu')).toBeNull()
  })

  it('allows Escape to close slash menu opened by typing slash', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          inputText: '/to',
        })}
      />,
    )

    const input = screen.getByPlaceholderText('Ask for follow-up changes')
    expect(screen.queryByTestId('composer-slash-menu')).not.toBeNull()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('composer-slash-menu')).toBeNull()
  })

  it('does not send on Enter while IME composition is active', () => {
    const onSend = vi.fn((event) => event.preventDefault())
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          inputText: 'zhang',
          onSend,
        })}
      />,
    )

    const input = screen.getByPlaceholderText('Ask for follow-up changes')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, {
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: true, keyCode: 229 },
    })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('requires Cmd/Ctrl+Enter for long prompt when longTextRequireCmdEnter is enabled', () => {
    const onSend = vi.fn((event) => event.preventDefault())
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          inputText: 'line 1\nline 2',
          longTextRequireCmdEnter: true,
          onSend,
        })}
      />,
    )

    const input = screen.getByPlaceholderText('Ask for follow-up changes')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('renders running reasoning as a collapsed block', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({ logs: [{ id: 'thinking-1', kind: 'thinking', status: 'running', text: 'Step A. Step B.', turnId: 'turn-1' }] })}
      />,
    )

    const reasoning = screen.getByRole('button', { name: /Reasoning/i })
    expect(reasoning).toHaveAttribute('aria-expanded', 'false')
    expect(reasoning.className).not.toContain('hover:bg')
    expect(reasoning).not.toHaveClass('px-1')
    expect(screen.queryByText('Step A. Step B.')).not.toBeInTheDocument()

    fireEvent.click(reasoning)
    expect(reasoning).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Step A. Step B.')).toBeInTheDocument()
    const reasoningContent = screen.getByTestId('reasoning-content')
    expect(reasoningContent.querySelector('.reasoning-markdown')).not.toBeNull()
    expect(reasoningContent).not.toHaveClass('bg-muted/20')
    expect(reasoningContent).not.toHaveClass('px-3')
    expect(reasoningContent).not.toHaveClass('py-2')
    expect(reasoningContent).not.toHaveClass('rounded-md')
  })

  it('renders compact welcome canvas without prompt ideas', () => {
    const { container } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeThreadId: null,
          surfaceKind: 'welcome',
          logs: [],
        })}
      />,
    )

    expect(screen.getByText('Welcome to Formax')).toBeInTheDocument()
    expect(screen.queryByText(/^formax$/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Build a classic Snake game in this repo.')).not.toBeInTheDocument()
    expect(screen.queryByText('Create a one-page $pdf that summarizes this app.')).not.toBeInTheDocument()
    expect(screen.queryByText('Create a plan to...')).not.toBeInTheDocument()
    expect(screen.queryByText('Prompt idea')).not.toBeInTheDocument()
    expect(container.querySelector('[data-radix-scroll-area-viewport]')).toBeNull()
  })

  it('defaults to the centered draft surface when no thread is active', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeThreadId: null,
          logs: [],
          draftCwdOptions: ['/repo-1'],
          onDraftCwdChange: vi.fn(),
        })}
      />,
    )

    expect(screen.getByTestId('new-thread-draft-surface')).toBeInTheDocument()
    expect(screen.getByText('What should we build in this project?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })

  it('renders finalized reasoning as a collapsed block', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs: [{ id: 'thinking-1', kind: 'thinking', status: 'finalized', text: 'Step A.\nStep B.', turnId: 'turn-1' }],
        })}
      />,
    )

    const reasoning = screen.getByRole('button', { name: /Reasoning/i })
    expect(reasoning).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Step A\.\s*Step B\./)).not.toBeInTheDocument()

    fireEvent.click(reasoning)
    expect(reasoning).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Step A\.\s*Step B\./)).toBeInTheDocument()
  })

  it('counts finalized reasoning rows against transcript render window', () => {
    const messageLogs = Array.from({ length: 25 }, (_, index) => ({
      id: `msg-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `msg-${index}`,
    }))
    const finalizedThinking = Array.from({ length: 10 }, (_, index) => ({
      id: `thinking-final-${index}`,
      kind: 'thinking' as const,
      status: 'finalized' as const,
      text: `hidden-think-${index}`,
      turnId: 'turn-1',
    }))

    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs: [...messageLogs, ...finalizedThinking],
        })}
      />,
    )

    expect(screen.queryByText('msg-0')).not.toBeInTheDocument()
    expect(screen.getByText('msg-5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Render earlier messages/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Reasoning/i })).toHaveLength(10)
    expect(screen.queryByText('hidden-think-0')).not.toBeInTheDocument()
  })

  it('adds visual turn boundaries when turn id changes in transcript stream', () => {
    const { container } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs: [
            { id: 't1-msg', kind: 'message', role: 'assistant', text: 'turn-1 message', turnId: 'turn-1' },
            { id: 'mid-log', kind: 'log', text: 'informational', level: 'warn' },
            {
              id: 't1-tool',
              kind: 'tool_call',
              turnId: 'turn-1',
              toolUseId: 'tool-1',
              toolName: 'Bash',
              status: 'completed',
              summary: 'Ran ls',
              detailLines: [],
            },
            { id: 't2-msg', kind: 'message', role: 'assistant', text: 'turn-2 message', turnId: 'turn-2' },
          ],
        })}
      />,
    )

    expect(container.querySelectorAll('[data-turn-group-start=\"true\"]')).toHaveLength(2)
  })

  it('marks first visible turn as a boundary after render-window slicing', () => {
    const logs = Array.from({ length: 35 }, (_, index) => ({
      id: `slice-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `slice-msg-${index}`,
      turnId: index >= 4 && index <= 8 ? 'turn-1' : index >= 9 && index <= 11 ? 'turn-2' : undefined,
    }))

    const { container } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs,
        })}
      />,
    )

    expect(container.querySelectorAll('[data-turn-group-start=\"true\"]')).toHaveLength(2)

    const firstVisibleTurn = screen.getByText('slice-msg-5').closest('[data-turn-group-start=\"true\"]')
    expect(firstVisibleTurn).not.toBeNull()
  })

  it('renders provided logs and keeps load-earlier callback wiring', () => {
    const onLoadEarlier = vi.fn()

    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          historyMore: true,
          onLoadEarlier,
          logs: [
            { id: 'm1', kind: 'message', role: 'assistant', text: 'hello' },
            { id: 'l1', kind: 'log', text: 'warn log', level: 'warn' },
            {
              id: 't1',
              kind: 'tool_call',
              turnId: 'turn-1',
              toolUseId: 'tool-1',
              toolName: 'Bash',
              status: 'completed',
              summary: 'Ran command',
              detailLines: ['line'],
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('warn log')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Worked with 1 tool/i })).not.toBeInTheDocument()
    const toolGroupButton = screen.getByRole('button', { name: /ran 1 command/i })
    expect(toolGroupButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/^Bash$/)).not.toBeInTheDocument()

    fireEvent.click(toolGroupButton)
    const expandedToolGroupBody = toolGroupButton.nextElementSibling
    expect(expandedToolGroupBody).toBeInstanceOf(HTMLElement)
    expect(expandedToolGroupBody).not.toHaveClass('border-l')
    expect(expandedToolGroupBody).not.toHaveClass('pl-3')
    expect(screen.getByText(/^Bash$/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }))
    expect(onLoadEarlier).toHaveBeenCalledTimes(1)
  })

  it('uses the running tool item text as the live tool group title', () => {
    const { container } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeTurnId: 'turn-1',
          composerLocked: true,
          logs: [
            {
              id: 't1',
              kind: 'tool_call',
              turnId: 'turn-1',
              toolUseId: 'tool-1',
              toolName: 'Bash',
              status: 'running',
              summary: 'Running command',
              paramsText: 'command="pwd"',
              detailLines: [],
            },
          ],
        })}
      />,
    )

    const toolGroupButton = screen.getByRole('button', { name: /Bash pwd/i })
    expect(toolGroupButton.className).not.toContain('hover:bg')
    expect(toolGroupButton).not.toHaveClass('px-1')
    expect(container.querySelector('.cadenced-shimmer[data-active="true"]')).not.toBeNull()
  })

  it('shows thinking on the latest completed tool group while waiting for the next turn event', () => {
    const { container } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeTurnId: 'turn-1',
          composerLocked: true,
          logs: [
            {
              id: 't1',
              kind: 'tool_call',
              turnId: 'turn-1',
              toolUseId: 'tool-1',
              toolName: 'Bash',
              status: 'completed',
              summary: 'Ran command',
              paramsText: 'command="pwd"',
              detailLines: ['ok'],
            },
          ],
        })}
      />,
    )

    const toolGroupButton = screen.getByRole('button', { name: /Thinking/i })
    expect(toolGroupButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('turn-live-activity')).toBeNull()
    expect(container.querySelector('.cadenced-shimmer[data-active="true"]')).not.toBeNull()
  })

  it('shows a standalone thinking activity row after a submitted user message without a carrier block', () => {
    const { container } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeTurnId: 'turn-1',
          composerLocked: true,
          logs: [
            {
              id: 'u1',
              kind: 'message',
              role: 'user',
              text: 'hello',
              turnId: 'turn-1',
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('hello')).toBeInTheDocument()
    const liveActivity = screen.getByTestId('turn-live-activity')
    expect(liveActivity).toHaveTextContent('Thinking')
    expect(liveActivity).not.toHaveClass('px-1')
    expect(container.querySelector('.cadenced-shimmer[data-active="true"]')).not.toBeNull()
  })

  it('hides the empty-thread placeholder while the first turn is starting', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          activeTurnId: 'turn-1',
          logs: [],
          isSending: true,
        })}
      />,
    )

    expect(screen.queryByText('This thread is empty. Start with a first message.')).not.toBeInTheDocument()
    expect(screen.getByTestId('turn-live-activity')).toHaveTextContent('Thinking')
  })

  it('renders notice rows as system feedback items', () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs: [{ id: 'n1', kind: 'notice', level: 'info', text: 'Input resolved: submitted' }],
        })}
      />,
    )

    expect(screen.getByText('notice')).toBeInTheDocument()
    expect(screen.getByText('Input resolved: submitted')).toBeInTheDocument()
  })

  it('shows jump-to-bottom button when user scrolls up', async () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs: [
            { id: 'm1', kind: 'message', role: 'assistant', text: 'a' },
            { id: 'm2', kind: 'message', role: 'assistant', text: 'b' },
          ],
        })}
      />,
    )

    const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
    expect(viewport).not.toBeNull()
    if (!viewport) return

    let scrollTopValue = 0
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => 1000,
    })
    Object.defineProperty(viewport, 'clientHeight', {
      configurable: true,
      get: () => 300,
    })
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value
      },
    })
    ;(viewport as any).scrollTo = (arg: number | ScrollToOptions) => {
      if (typeof arg === 'number') {
        scrollTopValue = arg
        return
      }
      scrollTopValue = Number(arg?.top ?? 0)
    }

    scrollTopValue = 120
    fireEvent.scroll(viewport)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Jump to bottom' })).toBeInTheDocument()
    })
    const jumpButton = screen.getByRole('button', { name: 'Jump to bottom' })
    const jumpWrapper = jumpButton.parentElement
    expect(jumpWrapper?.className).toContain('absolute')
    expect(jumpWrapper?.className).toContain('left-1/2')
    expect(jumpWrapper?.className).toContain('-top-12')
    await waitFor(() => {
      expect(viewport.style.overflowAnchor).toBe('none')
    })

    fireEvent.click(jumpButton)
    expect(scrollTopValue).toBe(1000)
    await waitFor(() => {
      expect(viewport.style.overflowAnchor).toBe('auto')
    })
  })

  it('coalesces burst scroll events into a single animation frame update', async () => {
    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs: [
            { id: 'm1', kind: 'message', role: 'assistant', text: 'a' },
            { id: 'm2', kind: 'message', role: 'assistant', text: 'b' },
          ],
        })}
      />,
    )

    const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
    expect(viewport).not.toBeNull()
    if (!viewport) return

    let scrollTopValue = 0
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => 1000,
    })
    Object.defineProperty(viewport, 'clientHeight', {
      configurable: true,
      get: () => 300,
    })
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value
      },
    })
    await waitFor(() => {
      expect(viewport.style.overflowAnchor).toBe('auto')
    })

    // First transition away from bottom before spying; this may trigger state/effect rebinding.
    scrollTopValue = 120
    fireEvent.scroll(viewport)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Jump to bottom' })).toBeInTheDocument()
    })

    const queuedFrames: FrameRequestCallback[] = []
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      queuedFrames.push(callback)
      return queuedFrames.length
    })

    try {
      fireEvent.scroll(viewport)
      fireEvent.scroll(viewport)

      expect(queuedFrames).toHaveLength(1)
      act(() => {
        queuedFrames[0]?.(0)
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Jump to bottom' })).toBeInTheDocument()
      })
    } finally {
      rafSpy.mockRestore()
    }
  })

  it('sticks to bottom when turn loading appears even if log length is unchanged', async () => {
    const { rerender } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs: [{ id: 'm1', kind: 'message', role: 'assistant', text: 'hello' }],
          isSending: false,
        })}
      />,
    )

    const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
    expect(viewport).not.toBeNull()
    if (!viewport) return

    let scrollTopValue = 0
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => 1200,
    })
    Object.defineProperty(viewport, 'clientHeight', {
      configurable: true,
      get: () => 300,
    })
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value
      },
    })
    ;(viewport as any).scrollTo = (arg: number | ScrollToOptions) => {
      if (typeof arg === 'number') {
        scrollTopValue = arg
        return
      }
      scrollTopValue = Number(arg?.top ?? 0)
    }

    rerender(
      <TranscriptPane
        {...baseProps({
          logs: [{ id: 'm1', kind: 'message', role: 'assistant', text: 'hello' }],
          isSending: true,
        })}
      />,
    )

    await waitFor(() => {
      expect(scrollTopValue).toBe(1200)
    })
    expect(screen.queryByTestId('turn-loading')).toBeNull()
  })

  it('renders long history in batches and can reveal earlier in-memory messages', () => {
    const logs = Array.from({ length: 260 }, (_, index) => ({
      id: `m-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `msg-${index}`,
    }))

    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs,
        })}
      />,
    )

    expect(screen.queryByText('msg-0')).not.toBeInTheDocument()
    expect(screen.getByText('msg-259')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Render earlier messages/i }))
    expect(screen.queryByText('msg-0')).not.toBeInTheDocument()
    expect(screen.getByText('msg-180')).toBeInTheDocument()
  })

  it('expands render window in batches when loading earlier server history', () => {
    const onLoadEarlier = vi.fn()
    const logs = Array.from({ length: 260 }, (_, index) => ({
      id: `s-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `server-msg-${index}`,
    }))

    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs,
          historyMore: true,
          onLoadEarlier,
        })}
      />,
    )

    expect(screen.queryByText('server-msg-0')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }))
    expect(onLoadEarlier).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('server-msg-0')).not.toBeInTheDocument()
    expect(screen.getByText('server-msg-180')).toBeInTheDocument()
  })

  it('reveals all earlier in-memory messages when dev load-all is active', async () => {
    const logs = Array.from({ length: 260 }, (_, index) => ({
      id: `all-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `all-msg-${index}`,
    }))

    const { rerender } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs,
          devLoadAllActive: false,
        })}
      />,
    )

    expect(screen.queryByText('all-msg-0')).not.toBeInTheDocument()

    rerender(
      <TranscriptPane
        {...baseProps({
          logs,
          devLoadAllActive: true,
        })}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('all-msg-0')).toBeInTheDocument()
    })
  })

  it('keeps earlier history visible after load-earlier prep request', () => {
    const onLoadEarlier = vi.fn()
    const { rerender } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          historyMore: true,
          onLoadEarlier,
          logs: [
            { id: 'newer-q', kind: 'message', role: 'user', text: 'newer question' },
            { id: 'newer-a', kind: 'message', role: 'assistant', text: 'newer answer' },
          ],
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }))
    expect(onLoadEarlier).toHaveBeenCalledTimes(1)

    rerender(
      <TranscriptPane
        {...baseProps({
          historyMore: false,
          logs: [
            { id: 'older-q', kind: 'message', role: 'user', text: 'older question' },
            { id: 'older-a', kind: 'message', role: 'assistant', text: 'older answer' },
            { id: 'newer-q', kind: 'message', role: 'user', text: 'newer question' },
            { id: 'newer-a', kind: 'message', role: 'assistant', text: 'newer answer' },
          ],
        })}
      />,
    )

    expect(screen.getByText('older answer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Render earlier messages/i })).not.toBeInTheDocument()
  })

  it('keeps scroll anchor stable when rendering earlier in-memory messages', async () => {
    const logs = Array.from({ length: 260 }, (_, index) => ({
      id: `a-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `anchor-msg-${index}`,
    }))

    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs,
        })}
      />,
    )

    const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
    expect(viewport).not.toBeNull()
    if (!viewport) {
      rafSpy.mockRestore()
      return
    }

    let scrollTopValue = 120
    let scrollHeightReads = 0

    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value
      },
    })
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => {
        scrollHeightReads += 1
        // first read = beforeHeight, second read = afterHeight
        return scrollHeightReads === 1 ? 1000 : 1300
      },
    })

    fireEvent.click(screen.getByRole('button', { name: /Render earlier messages/i }))

    await waitFor(() => {
      expect(scrollTopValue).toBe(420)
    })

    rafSpy.mockRestore()
  })

  it('keeps scroll anchor stable when loading earlier server history', async () => {
    const onLoadEarlier = vi.fn()
    const logs = Array.from({ length: 260 }, (_, index) => ({
      id: `l-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `load-msg-${index}`,
    }))

    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs,
          historyMore: true,
          onLoadEarlier,
        })}
      />,
    )

    const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
    expect(viewport).not.toBeNull()
    if (!viewport) {
      rafSpy.mockRestore()
      return
    }

    let scrollTopValue = 160
    let scrollHeightReads = 0

    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value
      },
    })
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => {
        scrollHeightReads += 1
        return scrollHeightReads === 1 ? 1100 : 1400
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }))

    expect(onLoadEarlier).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(scrollTopValue).toBe(460)
    })

    rafSpy.mockRestore()
  })

  it('does not auto-stick on new messages after user scrolls up', async () => {
    const initialLogs = [
      { id: 'u1', kind: 'message' as const, role: 'assistant' as const, text: 'hello-1' },
      { id: 'u2', kind: 'message' as const, role: 'assistant' as const, text: 'hello-2' },
    ]

    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    const { rerender, container } = renderWithI18n(
      <TranscriptPane
        {...baseProps({
          logs: initialLogs,
        })}
      />,
    )

    const viewport = container.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
    expect(viewport).not.toBeNull()
    if (!viewport) throw new Error('scroll-area viewport not found')

    try {
      let scrollTopValue = 0
      Object.defineProperty(viewport, 'scrollHeight', {
        configurable: true,
        get: () => 1000,
      })
      Object.defineProperty(viewport, 'clientHeight', {
        configurable: true,
        get: () => 300,
      })
      Object.defineProperty(viewport, 'scrollTop', {
        configurable: true,
        get: () => scrollTopValue,
        set: (value: number) => {
          scrollTopValue = value
        },
      })

      scrollTopValue = 120
      fireEvent.scroll(viewport)

      rerender(
        <TranscriptPane
          {...baseProps({
            logs: [...initialLogs, { id: 'u3', kind: 'message', role: 'assistant', text: 'hello-3' }],
          })}
        />,
      )

      await waitFor(() => {
        expect(scrollTopValue).toBe(120)
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Jump to bottom' })).toBeInTheDocument()
      })
    } finally {
      rafSpy.mockRestore()
    }
  })

  it('caps active-turn render window for very long histories', async () => {
    const restoreIdleCallbacks = installImmediateIdleCallbacks()
    const logs = Array.from({ length: 600 }, (_, index) => ({
      id: `long-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `long-msg-${index}`,
    }))

    try {
      renderWithI18n(
        <TranscriptPane
          {...baseProps({
            logs,
            activeTurnId: 'turn-long',
          })}
        />,
      )

      expect(screen.getByText('long-msg-599')).toBeInTheDocument()
      expect(screen.queryByText('long-msg-399')).not.toBeInTheDocument()

      await waitFor(() => {
        expect(screen.getByText('long-msg-400')).toBeInTheDocument()
      })
      expect(screen.queryByText('long-msg-399')).not.toBeInTheDocument()
    } finally {
      restoreIdleCallbacks()
    }
  })

  it('applies tighter active-turn render cap when virtualization is enabled', async () => {
    const restoreIdleCallbacks = installImmediateIdleCallbacks()
    const logs = Array.from({ length: 600 }, (_, index) => ({
      id: `virt-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `virt-msg-${index}`,
    }))

    try {
      renderWithI18n(
        <TranscriptPane
          {...baseProps({
            logs,
            activeTurnId: 'turn-virt',
            virtualizationEnabled: true,
          })}
        />,
      )

      expect(screen.getByText('virt-msg-599')).toBeInTheDocument()
      expect(screen.queryByText('virt-msg-479')).not.toBeInTheDocument()

      await waitFor(() => {
        expect(screen.getByText('virt-msg-480')).toBeInTheDocument()
      })
      expect(screen.queryByText('virt-msg-479')).not.toBeInTheDocument()
    } finally {
      restoreIdleCallbacks()
    }
  })

  it('stops wheel propagation only when viewport can still scroll in that direction', () => {
    expect(
      shouldStopWheelPropagation({
        deltaY: 10,
        scrollTop: 100,
        scrollHeight: 1000,
        clientHeight: 300,
      }),
    ).toBe(true)

    expect(
      shouldStopWheelPropagation({
        deltaY: 10,
        scrollTop: 700,
        scrollHeight: 1000,
        clientHeight: 300,
      }),
    ).toBe(false)

    expect(
      shouldStopWheelPropagation({
        deltaY: -10,
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 300,
      }),
    ).toBe(false)
  })
})
