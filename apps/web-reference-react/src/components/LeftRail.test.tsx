import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  {
    id: 'thread-22222222',
    cwd: '/repo-b',
    createdAt: '2026-02-09T00:00:00.000Z',
    updatedAt: '2026-02-09T00:00:00.000Z',
    messageCount: 1,
    lastUserPrompt: 'world',
    label: null,
  },
]

describe('LeftRail', () => {
  it('renders status and dispatches actions', () => {
    const onSelectThread = vi.fn()
    const onSelectCwd = vi.fn()
    const onStartThread = vi.fn()

    render(
      <LeftRail
        connectionStatus="connected"
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={onSelectCwd}
        activeThreadId={threads[0].id}
        onSelectThread={onSelectThread}
        onStartThread={onStartThread}
      />,
    )

    expect(screen.getByText('connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /new thread/i }))
    expect(onStartThread).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('hello').closest('button') as HTMLButtonElement)
    expect(onSelectThread).toHaveBeenCalledWith('thread-11111111')

    expect(screen.getByTitle('/repo-b')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /repo-b/i }))
    expect(onSelectCwd).toHaveBeenCalledWith('/repo-b')
  })

  it('supports thread action menu for rename/copy', async () => {
    const onRenameThread = vi.fn(async () => undefined)
    const writeText = vi.fn(async () => undefined)
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    try {
      render(
        <LeftRail
          threads={threads}
          selectedCwd="/repo"
          onSelectCwd={() => undefined}
          activeThreadId={threads[0].id}
          onSelectThread={() => undefined}
          onRenameThread={onRenameThread}
          onStartThread={() => undefined}
        />,
      )

      fireEvent.click(screen.getAllByLabelText('Thread actions')[0]!)
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename thread' }))
      const input = await screen.findByPlaceholderText('Thread title')
      fireEvent.change(input, { target: { value: 'Renamed by menu' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(onRenameThread).toHaveBeenCalledWith('thread-11111111', 'Renamed by menu')
      })

      fireEvent.click(screen.getAllByLabelText('Thread actions')[0]!)
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy working directory' }))
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('/repo')
      })

      fireEvent.click(screen.getAllByLabelText('Thread actions')[0]!)
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy session ID' }))
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('thread-11111111')
      })
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard)
      } else {
        Reflect.deleteProperty(navigator, 'clipboard')
      }
    }
  })
})
