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
        onStartThreadInCwd={() => undefined}
      />,
    )

    expect(screen.getByText('connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    expect(onStartThread).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /hello/i }))
    expect(onSelectThread).toHaveBeenCalledWith('thread-11111111')

    const repoBFolder = screen.getByTitle('/repo-b')
    expect(repoBFolder).toBeInTheDocument()
    fireEvent.click(repoBFolder)
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
          onStartThreadInCwd={() => undefined}
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

  it('starts a new thread in the selected folder from folder quick action', () => {
    const onStartThread = vi.fn()
    const onStartThreadInCwd = vi.fn()

    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={() => undefined}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={onStartThread}
        onStartThreadInCwd={onStartThreadInCwd}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start new thread in repo' }))
    expect(onStartThreadInCwd).toHaveBeenCalledWith('/repo')
    expect(onStartThread).not.toHaveBeenCalled()
  })

  it('disables folder quick action while thread actions are busy', () => {
    const onStartThreadInCwd = vi.fn()

    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={() => undefined}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={onStartThreadInCwd}
        isBusy
      />,
    )

    const quickActionButton = screen.getByRole('button', { name: 'Start new thread in repo' })
    expect(quickActionButton).toBeDisabled()
    fireEvent.click(quickActionButton)
    expect(onStartThreadInCwd).not.toHaveBeenCalled()
  })

  it('marks a folder as removed from folder actions menu', async () => {
    const onSelectCwd = vi.fn()

    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={onSelectCwd}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Folder actions for repo' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove session folder' }), { detail: 1, button: 0 })

    await waitFor(() => {
      expect(screen.queryByTitle('/repo')).not.toBeInTheDocument()
    })
    expect(screen.getByTitle('/repo-b')).toBeInTheDocument()
    expect(onSelectCwd).toHaveBeenCalledWith('/repo-b')
  })

  it('does not remove the selected folder when it is the only visible group', async () => {
    const onSelectCwd = vi.fn()

    render(
      <LeftRail
        threads={[threads[0]]}
        selectedCwd="/repo"
        onSelectCwd={onSelectCwd}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
      />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Folder actions for repo' }))
    const removeItem = await screen.findByRole('menuitem', { name: 'Remove session folder' })
    fireEvent.click(removeItem, { detail: 1, button: 0 })

    expect(screen.getByTitle('/repo')).toBeInTheDocument()
    expect(onSelectCwd).not.toHaveBeenCalled()
  })
})
