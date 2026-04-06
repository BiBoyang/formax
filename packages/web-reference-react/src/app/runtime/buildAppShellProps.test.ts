import { describe, expect, it, vi } from 'vitest'
import { buildAppShellProps } from './buildAppShellProps'

describe('buildAppShellProps', () => {
  it('merges sectioned fields into AppShellProps shape', () => {
    const props = buildAppShellProps({
      thread: {
        sortedThreads: [],
        selectedCwd: '/repo',
        onSelectCwd: vi.fn(),
        activeThreadId: 'thread-1',
        onSelectThread: vi.fn(),
        onRenameThread: vi.fn(),
        onArchiveThread: vi.fn(),
        onStartThread: vi.fn(),
        onStartThreadInCwd: vi.fn(),
        hiddenGroupCwds: [],
        onHideThreadGroup: vi.fn(),
        isThreadActionBusy: false,
      },
      layout: {
        isSidebarOpen: true,
        setIsSidebarOpen: vi.fn(),
        sidebarWidth: 24,
        isRightRailOpen: true,
        setIsRightRailOpen: vi.fn(),
        rightRailWidth: 40,
        setSidebarWidth: vi.fn(),
        setRightRailWidth: vi.fn(),
        isSettingsOpen: false,
        setIsSettingsOpen: vi.fn(),
      },
      transcript: {
        activeThreadTitle: 'T',
        activeThreadLatestRequestCollapse: null,
        activeTurnId: null,
        connectionStatus: 'connected',
        activeThread: undefined,
        transcriptVirtualizationEnabled: true,
        composerLocked: false,
        logs: [],
        inputText: 'hello',
        mode: 'normal',
        onModeChange: vi.fn(),
        onInputTextChange: vi.fn(),
        onSend: vi.fn(),
        onInterrupt: vi.fn(),
        historyMore: false,
        historyLoading: false,
        onLoadEarlier: vi.fn(),
        devLoadAllEnabled: true,
        devLoadAllRunning: false,
        onDevLoadAllEarlier: vi.fn(),
        isSending: false,
        isInterrupting: false,
        lastRpcError: null,
      },
      approval: {
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
      },
      diff: {
        diffSnapshot: null,
        onRefreshDiff: vi.fn(),
        onRequestDiffPatch: vi.fn(async () => null),
        isRefreshingDiff: false,
      },
      feedback: {
        noticeMessage: null,
      },
      settings: {
        userSettings: {
          defaultOpenTarget: 'cursor',
          language: 'zh-CN',
          preventSleep: true,
          longTextRequireCmdEnter: false,
        },
        onUserSettingChange: vi.fn(),
      },
    })

    expect(props.selectedCwd).toBe('/repo')
    expect(props.mode).toBe('normal')
    expect(props.noticeMessage).toBe(null)
    expect(props.activeThreadLatestRequestCollapse).toBe(null)
    expect(typeof props.onRequestDiffPatch).toBe('function')
    expect(props.userSettings.language).toBe('zh-CN')
  })
})
