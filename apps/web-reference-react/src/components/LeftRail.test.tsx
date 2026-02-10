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
    const onSelectThread = vi.fn()
    const onStartThread = vi.fn()

    render(
      <LeftRail
        connectionStatus="connected"
        threads={threads}
        activeThreadId={threads[0].id}
        onSelectThread={onSelectThread}
        onStartThread={onStartThread}
      />,
    )

    expect(screen.getByText('connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /new thread/i }))
    expect(onStartThread).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /hello/ }))
    expect(onSelectThread).toHaveBeenCalledWith('thread-11111111')
  })
})
