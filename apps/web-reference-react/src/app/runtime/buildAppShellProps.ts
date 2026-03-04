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
  | 'onStartThread'
  | 'onStartThreadInCwd'
  | 'hiddenGroupCwds'
  | 'onHideThreadGroup'
  | 'isThreadActionBusy'
>

type LayoutSection = Pick<
  AppShellProps,
  | 'isSidebarOpen'
  | 'setIsSidebarOpen'
  | 'sidebarWidth'
  | 'rightRailWidth'
  | 'setSidebarWidth'
  | 'setRightRailWidth'
>

type TranscriptSection = Pick<
  AppShellProps,
  | 'activeThreadTitle'
  | 'activeTurnId'
  | 'connectionStatus'
  | 'activeThread'
  | 'transcriptVirtualizationEnabled'
  | 'composerLocked'
  | 'logs'
  | 'inputText'
  | 'mode'
  | 'onModeChange'
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

export type BuildAppShellPropsArgs = {
  thread: ThreadSection
  layout: LayoutSection
  transcript: TranscriptSection
  approval: ApprovalSection
  diff: DiffSection
  feedback: FeedbackSection
}

export function buildAppShellProps(args: BuildAppShellPropsArgs): AppShellProps {
  return {
    ...args.thread,
    ...args.layout,
    ...args.transcript,
    ...args.approval,
    ...args.diff,
    ...args.feedback,
  }
}
