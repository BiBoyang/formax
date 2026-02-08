import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LeftRail } from './LeftRail'

const threads = [
  {
    id: 'thread-11111111',
    cwd: '/repo',
    createdAt: '2026-02-09T00:00:00.000Z',
    updatedAt: '2026-02-09T00:00:00.000Z',
    messageCount: 1,
    lastUserPrompt: 'hello',
    label: null,
  },
]

describe('LeftRail', () => {
  it('renders status and dispatches actions', () => {
    const onBridgeUrlChange = vi.fn()
    const onSelectThread = vi.fn()
    const onStartThread = vi.fn()
    const onRefreshThreads = vi.fn()

    render(
      <LeftRail
        connectionStatus="connected"
        bridgeUrl="ws://127.0.0.1:3777"
        onBridgeUrlChange={onBridgeUrlChange}
        threads={threads}
        activeThreadId={threads[0].id}
        onSelectThread={onSelectThread}
        onStartThread={onStartThread}
        onRefreshThreads={onRefreshThreads}
      />,
    )

    expect(screen.getByText('connected')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('ws://127.0.0.1:3777'), {
      target: { value: 'ws://localhost:3999' },
    })
    expect(onBridgeUrlChange).toHaveBeenCalledWith('ws://localhost:3999')

    fireEvent.click(screen.getByRole('button', { name: 'New Thread' }))
    expect(onStartThread).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onRefreshThreads).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /hello/ }))
    expect(onSelectThread).toHaveBeenCalledWith('thread-11111111')
  })
})
