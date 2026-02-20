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
    title: 'hello',
  },
  {
    id: 'thread-22222222',
    cwd: '/repo-b',
    createdAt: '2026-02-09T00:00:00.000Z',
    updatedAt: '2026-02-09T00:00:00.000Z',
    messageCount: 1,
    lastUserPrompt: 'world',
    label: null,
    title: 'world',
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

    fireEvent.click(screen.getByRole('button', { name: /hello/i }))
    expect(onSelectThread).toHaveBeenCalledWith('thread-11111111')

    expect(screen.getByTitle('/repo-b')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /repo-b/i }))
    expect(onSelectCwd).toHaveBeenCalledWith('/repo-b')
  })

  it('supports thread action menu for rename/copy', async () => {
    const onRenameThread = vi.fn(async () => undefined)
    const onArchiveThread = vi.fn(async () => undefined)
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
          onArchiveThread={onArchiveThread}
          onStartThread={() => undefined}
        />,
      )

      const helloButton = screen.getByRole('button', { name: /hello/i })
      const worldButton = screen.getByRole('button', { name: /world/i })

      // Opening another row context menu should not auto-open rename dialog.
      fireEvent.contextMenu(worldButton)
      expect(screen.queryByRole('dialog', { name: /Rename thread/i })).not.toBeInTheDocument()

      fireEvent.contextMenu(helloButton)
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename thread' }), { detail: 1, button: 0 })
      const input = await screen.findByPlaceholderText('Thread title')
      fireEvent.change(input, { target: { value: 'Renamed by menu' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(onRenameThread).toHaveBeenCalledWith('thread-11111111', 'Renamed by menu')
      })

      fireEvent.contextMenu(helloButton)
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive thread' }), { detail: 1, button: 0 })
      await waitFor(() => {
        expect(onArchiveThread).toHaveBeenCalledWith('thread-11111111')
      })

      fireEvent.contextMenu(helloButton)
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy working directory' }), { detail: 1, button: 0 })
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('/repo')
      })

      fireEvent.contextMenu(helloButton)
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy session ID' }), { detail: 1, button: 0 })
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
