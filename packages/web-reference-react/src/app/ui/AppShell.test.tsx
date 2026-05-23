import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AppShellProps } from './AppShell'
import { AppShell } from './AppShell'
import { I18nProvider } from '../i18n/I18nProvider'

const desktopState = vi.hoisted(() => ({
  openPath: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../components/LeftRail', () => ({
  LeftRail: (props: { selectedCwd: string | null; activeThreadId: string | null; currentGroupCwd?: string | null }) => (
    <div
      data-testid="mock-left-rail"
      data-selected-cwd={props.selectedCwd ?? ''}
      data-active-thread-id={props.activeThreadId ?? ''}
      data-current-group-cwd={props.currentGroupCwd ?? ''}
    />
  ),
}))

vi.mock('../../components/TranscriptPane', () => ({
  TranscriptPane: (props: { activeThreadId: string | null; logs: unknown[] }) => (
    <div
      data-testid="mock-transcript-pane"
      data-active-thread-id={props.activeThreadId ?? ''}
      data-log-count={String(props.logs.length)}
    />
  ),
}))

vi.mock('../../components/InputApprovalDock', () => ({
  InputApprovalDock: (props: { input: unknown }) =>
    props.input ? <div data-testid="mock-approval-dock" /> : null,
}))

vi.mock('../../components/TerminalPane', () => ({
  TerminalPane: (props: { visible: boolean }) =>
    props.visible ? <div data-testid="mock-terminal-pane" /> : null,
}))

vi.mock('../../components/SettingsPane', () => ({
  SettingsPane: () => <div data-testid="mock-settings-pane" />,
}))

vi.mock('../../components/WorktreeDiffPane', () => ({
  WorktreeDiffPane: (props: { diffSnapshot?: { cwd?: string | null } | null }) => (
    <div data-testid="mock-worktree-diff-pane">{props.diffSnapshot?.cwd ?? 'none'}</div>
  ),
}))

vi.mock('../../components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div data-testid="mock-resize-handle" />,
}))

vi.mock('./useDesktopBridge', () => ({
  useDesktopBridge: () => ({
    availableOpenTargets: [{ id: 'cursor', label: 'Cursor' }],
    desktopBridge: {
      openTargets: {
        openPath: desktopState.openPath,
      },
    },
    isDesktopClient: true,
    isWindowTransparent: false,
    onToggleWindowTransparency: vi.fn(),
    terminalBridge: null,
  }),
}))

vi.mock('./usePanelDragCommit', () => ({
  usePanelDragCommit: () => ({
    onLeftDragStateChange: vi.fn(),
    onLeftResize: vi.fn(),
    onRightDragStateChange: vi.fn(),
    onRightResize: vi.fn(),
    onToggleRightRail: vi.fn(),
    onToggleSidebar: vi.fn(),
  }),
}))

vi.mock('./useTerminalVisibility', () => ({
  useTerminalVisibility: (args: { activeThreadId: string | null }) => ({
    canToggleTerminal: false,
    onCloseTerminalPane: vi.fn(),
    onTerminalDragStateChange: vi.fn(),
    onTerminalResize: vi.fn(),
    onToggleTerminal: vi.fn(),
    showTerminalPane: Boolean(args.activeThreadId),
    terminalHeightPercent: 0,
    terminalPaneThreadId: args.activeThreadId,
  }),
}))

function createProps(overrides: Partial<AppShellProps> = {}): AppShellProps {
  return {
    sortedThreads: [],
    selectedCwd: '/tmp',
    onSelectCwd: vi.fn(),
    activeThreadId: null,
    onSelectThread: vi.fn(),
    onRenameThread: vi.fn(),
    onArchiveThread: vi.fn(),
    onEnterNewThreadDraft: vi.fn(),
    onEnterNewThreadDraftInCwd: vi.fn(),
    onEnterAddProjectDraft: vi.fn(),
    hiddenGroupCwds: [],
    onHideThreadGroup: vi.fn(),
    isThreadActionBusy: false,
    isSidebarOpen: true,
    setIsSidebarOpen: vi.fn(),
    sidebarWidth: 24,
    isRightRailOpen: true,
    setIsRightRailOpen: vi.fn(),
    rightRailWidth: 36,
    setSidebarWidth: vi.fn(),
    setRightRailWidth: vi.fn(),
    isSettingsOpen: false,
    setIsSettingsOpen: vi.fn(),
    activeThreadTitle: 'New Thread',
    activeThreadLatestCompactBoundary: {
      schemaVersion: 1,
      trigger: 'auto',
      preTokens: 2048,
      summaryKind: 'session_memory',
    },
    activeThreadLatestRequestCollapse: {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'fp-1',
    },
    activeContextMeter: {
      available: true,
      source: 'usage',
      usedTokens: 1000,
      limitTokens: 95000,
      percentUsed: 1,
      percentRemaining: 99,
      shouldAutoCompact: false,
      label: '1% used (1k/95k, usage)',
      tone: 'normal',
    },
    showContextMeter: true,
    activeTurnId: 'turn-1',
    connectionStatus: 'connected',
    activeThread: undefined,
    transcriptVirtualizationEnabled: true,
    composerLocked: false,
    visibleSurface: 'newThreadDraft',
    draftCwd: null,
    draftCwdOptions: ['/repo-draft'],
    onDraftCwdChange: vi.fn(),
    logs: [],
    inputText: '',
    mode: 'normal',
    onModeChange: vi.fn(),
    onInputTextChange: vi.fn(),
    onSend: vi.fn(),
    onInterrupt: vi.fn(),
    historyMore: false,
    historyLoading: false,
    onLoadEarlier: vi.fn(),
    devLoadAllEnabled: false,
    devLoadAllRunning: false,
    onDevLoadAllEarlier: vi.fn(),
    isSending: false,
    isInterrupting: false,
    lastRpcError: null,
    selectedInput: null,
    isSelectedAskOpen: false,
    selectedAskPageIndex: 0,
    selectedAskDraft: {},
    submitStatus: null,
    isSubmittingInput: false,
    onAskOpen: vi.fn(),
    onAskDismiss: vi.fn(),
    onAskPageChange: vi.fn(),
    onAskDraftChange: vi.fn(),
    onSubmitInput: vi.fn(),
    diffSnapshot: {
      cwd: '/tmp',
      generatedAt: '2026-05-23T00:00:00.000Z',
      hasChanges: true,
      truncated: false,
      files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
    },
    onRefreshDiff: vi.fn(),
    onRequestDiffPatch: vi.fn(async () => null),
    isRefreshingDiff: false,
    noticeMessage: null,
    userSettings: {
      defaultOpenTarget: 'cursor',
      language: 'en-US',
      preventSleep: true,
      longTextRequireCmdEnter: false,
    },
    onUserSettingChange: vi.fn(),
    ...overrides,
  }
}

function renderShell(overrides: Partial<AppShellProps> = {}) {
  desktopState.openPath.mockClear()
  return render(
    <I18nProvider language="en-US">
      <AppShell {...createProps(overrides)} />
    </I18nProvider>,
  )
}

describe('AppShell', () => {
  it('blanks thread-only shell chrome on the draft surface', () => {
    renderShell({
      selectedCwd: '/tmp',
      draftCwd: null,
      visibleSurface: 'newThreadDraft',
      activeThreadId: null,
      activeThread: undefined,
    })

    expect(screen.queryByText(/^tmp$/)).toBeNull()
    expect(screen.getByTestId('app-shell-open-folder-button')).toBeDisabled()
    expect(screen.queryByTestId('app-shell-context-meter')).toBeNull()
    expect(screen.queryByTestId('app-shell-collapse-summary')).toBeNull()
    expect(screen.queryByTestId('app-shell-compact-summary')).toBeNull()
    expect(screen.queryByTestId('mock-worktree-diff-pane')).toBeNull()
    expect(screen.queryByText('+210')).toBeNull()
    expect(screen.getByTestId('mock-left-rail')).toHaveAttribute('data-selected-cwd', '')
    expect(screen.getByTestId('mock-left-rail')).toHaveAttribute('data-active-thread-id', '')
    expect(screen.getByTestId('mock-left-rail')).toHaveAttribute('data-current-group-cwd', '')
    expect(screen.getByText('New Thread')).toBeInTheDocument()
    expect(screen.getByTestId('mock-transcript-pane')).toHaveAttribute('data-active-thread-id', '')
    expect(screen.getByTestId('mock-transcript-pane')).toHaveAttribute('data-log-count', '0')
  })

  it('uses draft cwd for header label and open-folder actions on the draft surface', () => {
    renderShell({
      selectedCwd: '/tmp',
      draftCwd: '/repo-draft',
      visibleSurface: 'newThreadDraft',
      activeThreadId: null,
      activeThread: undefined,
    })

    expect(screen.getByText('repo-draft')).toBeInTheDocument()
    expect(screen.queryByText(/^tmp$/)).toBeNull()
    expect(screen.getByTestId('mock-left-rail')).toHaveAttribute('data-current-group-cwd', '/repo-draft')

    fireEvent.click(screen.getByTestId('app-shell-open-folder-button'))

    expect(desktopState.openPath).toHaveBeenCalledWith('cursor', '/repo-draft')
  })

  it('preserves draft feedback logs when no stale thread selection exists', () => {
    renderShell({
      visibleSurface: 'newThreadDraft',
      activeThreadId: null,
      activeThread: undefined,
      logs: [
        {
          id: 'log-1',
          kind: 'log',
          text: 'Please choose a project before starting a new thread',
          level: 'warn',
        },
      ],
    })

    expect(screen.getByTestId('mock-transcript-pane')).toHaveAttribute('data-log-count', '1')
  })

  it('keeps the draft surface even when stale thread-only state is still present', () => {
    renderShell({
      visibleSurface: 'newThreadDraft',
      activeThreadId: 'thread-stale',
      activeThread: {
        id: 'thread-stale',
        cwd: '/repo-thread',
        createdAt: '2026-05-23T00:00:00.000Z',
        updatedAt: '2026-05-23T00:00:00.000Z',
        messageCount: 1,
        label: null,
        lastUserPrompt: null,
      },
      draftCwd: null,
      selectedCwd: '/tmp',
      selectedInput: {
        threadId: 'thread-stale',
        turnId: 'turn-1',
        inputId: 'input-1',
        toolUseId: 'tool-1',
        kind: 'approval',
        status: 'pending',
        createdAt: '2026-05-23T00:00:00.000Z',
        expiresAt: '2026-05-24T00:00:00.000Z',
        payload: { reason: 'approve' },
      },
      logs: [
        {
          id: 'log-1',
          kind: 'log',
          text: 'Please choose a project before starting a new thread',
          level: 'warn',
        },
      ],
    })

    expect(screen.queryByText(/^tmp$/)).toBeNull()
    expect(screen.queryByTestId('mock-worktree-diff-pane')).toBeNull()
    expect(screen.queryByTestId('app-shell-collapse-summary')).toBeNull()
    expect(screen.queryByTestId('app-shell-compact-summary')).toBeNull()
    expect(screen.queryByTestId('app-shell-context-meter')).toBeNull()
    expect(screen.queryByTestId('mock-approval-dock')).toBeNull()
    expect(screen.queryByTestId('mock-terminal-pane')).toBeNull()
    expect(screen.getByTestId('mock-left-rail')).toHaveAttribute('data-active-thread-id', '')
    expect(screen.getByTestId('mock-left-rail')).toHaveAttribute('data-current-group-cwd', '')
    expect(screen.getByTestId('mock-transcript-pane')).toHaveAttribute('data-active-thread-id', '')
    expect(screen.getByTestId('mock-transcript-pane')).toHaveAttribute('data-log-count', '1')
  })
})
