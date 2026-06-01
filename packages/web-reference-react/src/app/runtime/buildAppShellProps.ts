import type { AppShellProps } from '../ui/AppShell'

type ThreadSection = Pick<
  AppShellProps,
  | 'sortedThreads'
  | 'selectedCwd'
  | 'onSelectCwd'
  | 'activeThreadId'
  | 'onSelectThread'
  | 'onRenameThread'
  | 'onArchiveThread'
  | 'onEnterNewThreadDraft'
  | 'onEnterNewThreadDraftInCwd'
  | 'onEnterAddProjectDraft'
  | 'hiddenGroupCwds'
  | 'onHideThreadGroup'
  | 'isThreadActionBusy'
>

type LayoutSection = Pick<
  AppShellProps,
  | 'isSidebarOpen'
  | 'setIsSidebarOpen'
  | 'sidebarWidth'
  | 'isRightRailOpen'
  | 'setIsRightRailOpen'
  | 'rightRailWidth'
  | 'setSidebarWidth'
  | 'setRightRailWidth'
  | 'isSettingsOpen'
  | 'setIsSettingsOpen'
>

type TranscriptSection = Pick<
  AppShellProps,
  | 'activeThreadTitle'
  | 'activeThreadLatestCompactBoundary'
  | 'activeThreadLatestRequestCollapse'
  | 'activeContextMeter'
  | 'showContextMeter'
  | 'activeTurnId'
  | 'connectionStatus'
  | 'activeThread'
  | 'transcriptVirtualizationEnabled'
  | 'composerLocked'
  | 'visibleSurface'
  | 'draftCwd'
  | 'draftCwdOptions'
  | 'onDraftCwdChange'
  | 'logs'
  | 'inputText'
  | 'mode'
  | 'modelTier'
  | 'thinkingMode'
  | 'onModeChange'
  | 'onModelTierChange'
  | 'onThinkingModeChange'
  | 'onInputTextChange'
  | 'onSend'
  | 'onInterrupt'
  | 'historyMore'
  | 'historyLoading'
  | 'onLoadEarlier'
  | 'devLoadAllEnabled'
  | 'devLoadAllRunning'
  | 'onDevLoadAllEarlier'
  | 'isSending'
  | 'isInterrupting'
  | 'lastRpcError'
>

type ApprovalSection = Pick<
  AppShellProps,
  | 'selectedInput'
  | 'isSelectedAskOpen'
  | 'selectedAskPageIndex'
  | 'selectedAskDraft'
  | 'submitStatus'
  | 'isSubmittingInput'
  | 'onAskOpen'
  | 'onAskDismiss'
  | 'onAskPageChange'
  | 'onAskDraftChange'
  | 'onSubmitInput'
>

type DiffSection = Pick<
  AppShellProps,
  'diffSnapshot' | 'onRefreshDiff' | 'onRequestDiffPatch' | 'isRefreshingDiff'
>

type FeedbackSection = Pick<AppShellProps, 'noticeMessage'>

type SettingsSection = Pick<AppShellProps, 'userSettings' | 'onUserSettingChange'>

export type BuildAppShellPropsArgs = {
  thread: ThreadSection
  layout: LayoutSection
  transcript: TranscriptSection
  approval: ApprovalSection
  diff: DiffSection
  feedback: FeedbackSection
  settings: SettingsSection
}

export function buildAppShellProps(args: BuildAppShellPropsArgs): AppShellProps {
  return {
    ...args.thread,
    ...args.layout,
    ...args.transcript,
    ...args.approval,
    ...args.diff,
    ...args.feedback,
    ...args.settings,
  }
}
