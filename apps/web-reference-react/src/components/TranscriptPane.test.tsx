import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TranscriptPane } from './TranscriptPane'

describe('TranscriptPane', () => {
  it('enforces disabled states for send/interrupt', () => {
    const onInputTextChange = vi.fn()
    const onSend = vi.fn((event) => event.preventDefault())
    const onInterrupt = vi.fn()

    const { rerender } = render(
      <TranscriptPane
        activeThreadId={null}
        activeTurnId={null}
        logs={[]}
        inputText="hello"
        connectionStatus="disconnected"
        onInputTextChange={onInputTextChange}
        onSend={onSend}
        onInterrupt={onInterrupt}
      />,
    )

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Interrupt' })).toBeDisabled()

    rerender(
      <TranscriptPane
        activeThreadId="thread-1"
        activeTurnId="turn-1"
        logs={[{ id: '1', kind: 'message', role: 'assistant', text: 'ok', turnId: 'turn-1' }]}
        inputText="hello"
        connectionStatus="connected"
        onInputTextChange={onInputTextChange}
        onSend={onSend}
        onInterrupt={onInterrupt}
      />,
    )

    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Interrupt' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    expect(onInterrupt).toHaveBeenCalledTimes(1)

    fireEvent.submit(screen.getByRole('button', { name: 'Send' }).closest('form')!)
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('renders thinking as lightweight shimmer label', () => {
    render(
      <TranscriptPane
        activeThreadId="thread-1"
        activeTurnId="turn-1"
        logs={[{ id: 'thinking-1', kind: 'thinking', text: 'Step A. Step B.', turnId: 'turn-1' }]}
        inputText=""
        connectionStatus="connected"
        onInputTextChange={vi.fn()}
        onSend={vi.fn((event) => event.preventDefault())}
        onInterrupt={vi.fn()}
      />,
    )

    expect(screen.getByText('thinking')).toBeInTheDocument()
    expect(screen.queryByText('Step A. Step B.')).not.toBeInTheDocument()
  })

  it('filters by active turn and log level while keeping tool events visible', () => {
    render(
      <TranscriptPane
        activeThreadId="thread-1"
        activeTurnId="turn-2"
        logs={[
          { id: 'u1', kind: 'message', role: 'user', text: 'hello', turnId: 'turn-1' },
          { id: 'a2', kind: 'message', role: 'assistant', text: 'world', turnId: 'turn-2' },
          { id: 'l1', kind: 'log', text: 'warn log', level: 'warn', turnId: 'turn-2' },
          { id: 'l2', kind: 'log', text: 'info log', level: 'info', turnId: 'turn-2' },
          { id: 't2', kind: 'tool', phase: 'start', text: 'tool start', turnId: 'turn-2', toolUseId: 'tool-2' },
        ]}
        inputText=""
        connectionStatus="connected"
        onInputTextChange={vi.fn()}
        onSend={vi.fn((event) => event.preventDefault())}
        onInterrupt={vi.fn()}
      />,
    )

    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('world')).toBeInTheDocument()
    expect(screen.getByText('tool start')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Active Turn' }))
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
    expect(screen.getByText('world')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'warn' }))
    expect(screen.getByText('warn log')).toBeInTheDocument()
    expect(screen.queryByText('info log')).not.toBeInTheDocument()
  })

})
