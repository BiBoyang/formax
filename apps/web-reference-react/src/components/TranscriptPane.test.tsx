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
})
