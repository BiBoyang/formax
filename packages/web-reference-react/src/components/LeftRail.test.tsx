import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LeftRail } from './LeftRail'

const OPEN_BY_CWD_STORAGE_KEY = 'formax.web.leftRail.openByCwd.v1'

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
  beforeEach(() => {
    window.localStorage.clear()
  })

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
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
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

  it('shows top fade only after passing the scroll threshold', () => {
    const { container } = render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={() => undefined}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
      />,
    )

    const scrollBody = container.querySelector('.left-rail-scroll-body')
    expect(scrollBody).not.toBeNull()
    expect(scrollBody).toHaveClass('app-scroll-fade-mask-bottom')
    expect(scrollBody).not.toHaveClass('app-scroll-fade-mask-y')

    if (!scrollBody) return
    scrollBody.scrollTop = 90
    fireEvent.scroll(scrollBody)
    expect(scrollBody).toHaveClass('app-scroll-fade-mask-y')
    expect(scrollBody).not.toHaveClass('app-scroll-fade-mask-bottom')

    scrollBody.scrollTop = 40
    fireEvent.scroll(scrollBody)
    expect(scrollBody).toHaveClass('app-scroll-fade-mask-bottom')
    expect(scrollBody).not.toHaveClass('app-scroll-fade-mask-y')
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
          hiddenGroupCwds={[]}
          onHideThreadGroup={() => undefined}
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
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
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
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
        isBusy
      />,
    )

    const quickActionButton = screen.getByRole('button', { name: 'Start new thread in repo' })
    expect(quickActionButton).toBeDisabled()
    fireEvent.click(quickActionButton)
    expect(onStartThreadInCwd).not.toHaveBeenCalled()
  })

  it('shows desktop-only tooltip for add project action when folder picker is unavailable', async () => {
    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={() => undefined}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
      />,
    )

    const addProjectButton = screen.getByRole('button', { name: 'Add project' })
    expect(addProjectButton).toBeInTheDocument()

    fireEvent.pointerMove(addProjectButton)
    fireEvent.mouseEnter(addProjectButton)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('仅桌面客户端可用')
  })

  it('runs add project action when folder picker is available', async () => {
    const onCreateProject = vi.fn(async () => undefined)

    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={() => undefined}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
        onCreateProject={onCreateProject}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await waitFor(() => {
      expect(onCreateProject).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByText('仅桌面客户端可用')).not.toBeInTheDocument()
  })

  it('marks a folder as removed from folder actions menu', async () => {
    const onSelectCwd = vi.fn()
    const onHideThreadGroup = vi.fn()

    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={onSelectCwd}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={onHideThreadGroup}
      />,
    )

    const folderActionsButton = screen.getByRole('button', { name: 'Folder actions for repo' })
    fireEvent.mouseDown(folderActionsButton, { button: 0 })
    fireEvent.pointerDown(folderActionsButton, { button: 0, ctrlKey: false })
    fireEvent.click(folderActionsButton)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove session folder' }), { detail: 1, button: 0 })

    expect(onHideThreadGroup).toHaveBeenCalledWith('/repo')
    expect(onSelectCwd).toHaveBeenCalledWith('/repo-b')
  })

  it('opens folder actions menu on left click and ignores right click', async () => {
    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={() => undefined}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
      />,
    )

    const folderActionsButton = screen.getByRole('button', { name: 'Folder actions for repo' })
    fireEvent.contextMenu(folderActionsButton)
    expect(screen.queryByRole('menuitem', { name: 'Remove session folder' })).not.toBeInTheDocument()

    fireEvent.mouseDown(folderActionsButton, { button: 0 })
    fireEvent.pointerDown(folderActionsButton, { button: 0, ctrlKey: false })
    fireEvent.click(folderActionsButton)
    expect(await screen.findByRole('menuitem', { name: 'Remove session folder' })).toBeInTheDocument()
  })

  it('closes folder actions menu after clicking outside', async () => {
    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={() => undefined}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
      />,
    )

    const folderActionsButton = screen.getByRole('button', { name: 'Folder actions for repo' })
    fireEvent.mouseDown(folderActionsButton, { button: 0 })
    fireEvent.pointerDown(folderActionsButton, { button: 0, ctrlKey: false })
    fireEvent.click(folderActionsButton)
    expect(await screen.findByRole('menuitem', { name: 'Remove session folder' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body, { button: 0 })
    fireEvent.mouseDown(document.body, { button: 0 })
    fireEvent.click(document.body)

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Remove session folder' })).not.toBeInTheDocument()
    })
  })

  it('does not remove the selected folder when it is the only visible group', async () => {
    const onSelectCwd = vi.fn()
    const onHideThreadGroup = vi.fn()

    render(
      <LeftRail
        threads={[threads[0]]}
        selectedCwd="/repo"
        onSelectCwd={onSelectCwd}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={onHideThreadGroup}
      />,
    )

    const folderActionsButton = screen.getByRole('button', { name: 'Folder actions for repo' })
    fireEvent.mouseDown(folderActionsButton, { button: 0 })
    fireEvent.pointerDown(folderActionsButton, { button: 0, ctrlKey: false })
    fireEvent.click(folderActionsButton)
    const removeItem = await screen.findByRole('menuitem', { name: 'Remove session folder' })
    expect(removeItem).toHaveAttribute('data-disabled')
    fireEvent.click(removeItem, { detail: 1, button: 0 })

    expect(screen.getByTitle('/repo')).toBeInTheDocument()
    expect(onSelectCwd).not.toHaveBeenCalled()
    expect(onHideThreadGroup).not.toHaveBeenCalled()
  })

  it('hides groups from props-controlled hidden list', () => {
    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={() => undefined}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={['/repo']}
        onHideThreadGroup={() => undefined}
      />,
    )

    expect(screen.queryByTitle('/repo')).not.toBeInTheDocument()
    expect(screen.getByTitle('/repo-b')).toBeInTheDocument()
  })

  it('shows fixed bottom settings menu trigger', () => {
    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={() => undefined}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
      />,
    )

    const settingsTrigger = screen.getByRole('button', { name: '设置' })
    expect(settingsTrigger).toBeInTheDocument()
    expect(settingsTrigger).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('keeps cwd group order stable by folder name even when thread recency changes', () => {
    const unorderedThreads = [
      {
        id: 'thread-z',
        cwd: '/workspace/zeta',
        createdAt: '2026-02-09T00:00:00.000Z',
        updatedAt: '2026-02-13T00:00:00.000Z',
        messageCount: 1,
        lastUserPrompt: 'z',
        label: null,
        title: 'z',
      },
      {
        id: 'thread-a',
        cwd: '/workspace/alpha',
        createdAt: '2026-02-09T00:00:00.000Z',
        updatedAt: '2026-02-11T00:00:00.000Z',
        messageCount: 1,
        lastUserPrompt: 'a',
        label: null,
        title: 'a',
      },
      {
        id: 'thread-b',
        cwd: '/workspace/beta',
        createdAt: '2026-02-09T00:00:00.000Z',
        updatedAt: '2026-02-12T00:00:00.000Z',
        messageCount: 1,
        lastUserPrompt: 'b',
        label: null,
        title: 'b',
      },
    ]

    render(
      <LeftRail
        threads={unorderedThreads}
        selectedCwd="/workspace/alpha"
        onSelectCwd={() => undefined}
        activeThreadId={unorderedThreads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
      />,
    )

    const folderActionLabels = screen
      .getAllByRole('button', { name: /Folder actions for /i })
      .map((button) => button.getAttribute('aria-label'))
    expect(folderActionLabels).toEqual([
      'Folder actions for alpha',
      'Folder actions for beta',
      'Folder actions for zeta',
    ])
  })

  it('renders recent thread time with minute granularity instead of seconds', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-03-03T03:00:52.000Z'))
      render(
        <LeftRail
          threads={[
            {
              id: 'thread-recent',
              cwd: '/repo',
              createdAt: '2026-03-03T03:00:00.000Z',
              updatedAt: '2026-03-03T03:00:00.000Z',
              messageCount: 1,
              lastUserPrompt: 'recent',
              label: null,
              title: 'recent',
            },
          ]}
          selectedCwd="/repo"
          onSelectCwd={() => undefined}
          activeThreadId="thread-recent"
          onSelectThread={() => undefined}
          onStartThread={() => undefined}
          onStartThreadInCwd={() => undefined}
          hiddenGroupCwds={[]}
          onHideThreadGroup={() => undefined}
        />,
      )

      expect(screen.getByText('1m')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores folder open state from localStorage cache', () => {
    window.localStorage.setItem(OPEN_BY_CWD_STORAGE_KEY, JSON.stringify({ '/repo': false, '/repo-b': true }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo-b"
        onSelectCwd={() => undefined}
        activeThreadId={threads[1].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
      />,
    )

    expect(setItemSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /hello/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /world/i })).toBeInTheDocument()
    setItemSpy.mockRestore()
  })

  it('persists folder open state to localStorage after toggle', async () => {
    const { unmount } = render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo"
        onSelectCwd={() => undefined}
        activeThreadId={threads[0].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
      />,
    )

    fireEvent.click(screen.getByTitle('/repo'))
    await waitFor(() => {
      const raw = window.localStorage.getItem(OPEN_BY_CWD_STORAGE_KEY)
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw ?? '{}') as Record<string, boolean>
      expect(parsed['/repo']).toBe(false)
    })

    unmount()

    render(
      <LeftRail
        threads={threads}
        selectedCwd="/repo-b"
        onSelectCwd={() => undefined}
        activeThreadId={threads[1].id}
        onSelectThread={() => undefined}
        onStartThread={() => undefined}
        onStartThreadInCwd={() => undefined}
        hiddenGroupCwds={[]}
        onHideThreadGroup={() => undefined}
      />,
    )

    expect(screen.queryByRole('button', { name: /hello/i })).not.toBeInTheDocument()
  })
})
