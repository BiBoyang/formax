import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TranscriptPaneProps } from './TranscriptPane'
import { TranscriptPane } from './TranscriptPane'

function baseProps(overrides: Partial<TranscriptPaneProps> = {}): TranscriptPaneProps {
  return {
    activeThreadId: 'thread-1',
    activeTurnId: null,
    logs: [],
    inputText: '',
    connectionStatus: 'connected',
    onInputTextChange: vi.fn(),
    onSend: vi.fn((event) => event.preventDefault()),
    onInterrupt: vi.fn(),
    ...overrides,
  }
}

describe('TranscriptPane', () => {
  it('enforces send/interrupt states with current composer behavior', () => {
    const onInputTextChange = vi.fn()
    const onSend = vi.fn((event) => event.preventDefault())
    const onInterrupt = vi.fn()

    const { rerender } = render(
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
          connectionStatus: 'connected',
          inputText: 'hello',
          isSending: true,
          onInputTextChange,
          onSend,
          onInterrupt,
        })}
      />,
    )

    const interruptButton = screen.getByRole('button', { name: 'Interrupt turn' })
    expect(interruptButton).toBeEnabled()
    fireEvent.click(interruptButton)
    expect(onInterrupt).toHaveBeenCalledTimes(1)
  })

  it('renders thinking as lightweight label without delta body text', () => {
    render(
      <TranscriptPane
        {...baseProps({
          logs: [{ id: 'thinking-1', kind: 'thinking', text: 'Step A. Step B.', turnId: 'turn-1' }],
        })}
      />,
    )

    expect(screen.getByText('thinking')).toBeInTheDocument()
    expect(screen.queryByText('Step A. Step B.')).not.toBeInTheDocument()
  })

  it('adds visual turn boundaries when turn id changes in transcript stream', () => {
    const { container } = render(
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

  it('filters info logs while keeping warn/error and tool events visible', () => {
    const onLoadEarlier = vi.fn()

    render(
      <TranscriptPane
        {...baseProps({
          historyMore: true,
          onLoadEarlier,
          logs: [
            { id: 'm1', kind: 'message', role: 'assistant', text: 'hello' },
            { id: 'l1', kind: 'log', text: 'warn log', level: 'warn' },
            { id: 'l2', kind: 'log', text: 'info log', level: 'info' },
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
    expect(screen.queryByText('info log')).not.toBeInTheDocument()
    expect(screen.getByText('Ran command')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }))
    expect(onLoadEarlier).toHaveBeenCalledTimes(1)
  })

  it('shows jump-to-bottom button when user scrolls up', async () => {
    render(
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
    await waitFor(() => {
      expect(viewport.style.overflowAnchor).toBe('none')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Jump to bottom' }))
    expect(scrollTopValue).toBe(1000)
    await waitFor(() => {
      expect(viewport.style.overflowAnchor).toBe('auto')
    })
  })

  it('sticks to bottom when turn loading appears even if log length is unchanged', async () => {
    const { rerender } = render(
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
    expect(screen.getByTestId('turn-loading')).toBeInTheDocument()
  })

  it('renders long history in batches and can reveal earlier in-memory messages', () => {
    const logs = Array.from({ length: 260 }, (_, index) => ({
      id: `m-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `msg-${index}`,
    }))

    render(
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

    render(
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

    render(
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

    render(
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

    const { rerender, container } = render(
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
    const logs = Array.from({ length: 600 }, (_, index) => ({
      id: `long-${index}`,
      kind: 'message' as const,
      role: 'assistant' as const,
      text: `long-msg-${index}`,
    }))

    render(
      <TranscriptPane
        {...baseProps({
          logs,
          activeTurnId: 'turn-long',
        })}
      />,
    )

    expect(screen.getByText('long-msg-599')).toBeInTheDocument()
    expect(screen.queryByText('long-msg-399')).not.toBeInTheDocument()

    await waitFor(
      () => {
        expect(screen.getByText('long-msg-400')).toBeInTheDocument()
      },
      { timeout: 4000 },
    )
    expect(screen.queryByText('long-msg-399')).not.toBeInTheDocument()
  })
})
