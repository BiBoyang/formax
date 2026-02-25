import { useRef } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { PanelLeft } from 'lucide-react'
import { InputApprovalDock } from '../../components/InputApprovalDock'
import { LeftRail } from '../../components/LeftRail'
import { TranscriptPane } from '../../components/TranscriptPane'
import { WorktreeDiffPane, type DiffFilePatchPayload, type DiffSnapshot } from '../../components/WorktreeDiffPane'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../components/ui/resizable'
import { cn } from '../../lib/utils'
import type { PendingInput, ThreadSummary, TranscriptItem } from '../../types'
import type { ThreadViewModel } from '../core/threadViewModel'
import type { ReplMode } from '../../semantics'
import { RIGHT_RAIL_MAX_SIZE, RIGHT_RAIL_MIN_SIZE, SIDEBAR_MAX_SIZE, SIDEBAR_MIN_SIZE } from '../core/constants'
import { clampRightRailWidth, clampSidebarWidth } from './usePaneLayout'

export type AppShellProps = {
  sortedThreads: ThreadViewModel[]
  selectedCwd: string | null
  onSelectCwd: (cwd: string) => void
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onRenameThread: (threadId: string, label: string) => void
  onArchiveThread: (threadId: string) => void
  onStartThread: () => void
  onStartThreadInCwd: (cwd: string) => void
  isThreadActionBusy: boolean
  isSidebarOpen: boolean
  setIsSidebarOpen: (next: boolean) => void
  sidebarWidth: number
  rightRailWidth: number
  setSidebarWidth: Dispatch<SetStateAction<number>>
  setRightRailWidth: Dispatch<SetStateAction<number>>
  activeThreadTitle: string
  activeTurnId: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  activeThread: ThreadSummary | undefined
  transcriptVirtualizationEnabled: boolean
  composerLocked: boolean
  logs: TranscriptItem[]
  inputText: string
  mode: ReplMode
  onModeChange: (nextMode: ReplMode) => void
  onInputTextChange: (value: string) => void
  onSend: (event: FormEvent) => void
  onInterrupt: () => void
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  devLoadAllEnabled?: boolean
  devLoadAllRunning?: boolean
  onDevLoadAllEarlier?: () => void
  isSending: boolean
  isInterrupting: boolean
  lastRpcError: { at: string; method: string; message: string; code?: number; data?: unknown } | null
  selectedInput: PendingInput | null
  isSelectedAskOpen: boolean
  selectedAskPageIndex: number
  selectedAskDraft: Record<string, string>
  submitStatus: { status: string; kind: 'success' | 'error'; message?: string } | null
  isSubmittingInput: boolean
  onAskOpen: () => void
  onAskDismiss: () => void
  onAskPageChange: (page: number) => void
  onAskDraftChange: (fieldId: string, value: string) => void
  onSubmitInput: (inputId: string, answers: Record<string, string>) => void
  diffSnapshot: DiffSnapshot | null
  onRefreshDiff: () => void
  onRequestDiffPatch: (filePath: string) => Promise<DiffFilePatchPayload | null>
  isRefreshingDiff: boolean
  noticeMessage: string | null
}

export function AppShell(props: AppShellProps) {
  const sidebarPercent = props.sidebarWidth
  const sidebarMinPercent = SIDEBAR_MIN_SIZE
  const sidebarMaxPercent = SIDEBAR_MAX_SIZE
  const rightRailPercent = props.rightRailWidth
  const rightRailMinPercent = RIGHT_RAIL_MIN_SIZE
  const rightRailMaxPercent = RIGHT_RAIL_MAX_SIZE
  const centerPercent = Math.max(0, 100 - rightRailPercent)
  const pendingSidebarPercentRef = useRef(sidebarPercent)
  const pendingRightRailPercentRef = useRef(rightRailPercent)
  const isLeftDraggingRef = useRef(false)
  const isRightDraggingRef = useRef(false)
  const showDevLoadAllButton = props.devLoadAllEnabled === true

  const onLeftResize = (sidebarSizePercent: number) => {
    if (!props.isSidebarOpen) return
    const clampedSidebar = clampSidebarWidth(sidebarSizePercent)
    pendingSidebarPercentRef.current = clampedSidebar
    if (!isLeftDraggingRef.current && Math.abs(clampedSidebar - props.sidebarWidth) >= 1) {
      props.setSidebarWidth(clampedSidebar)
    }
  }

  const onRightResize = (rightSizePercent: number) => {
    const clampedRight = clampRightRailWidth(rightSizePercent)
    pendingRightRailPercentRef.current = clampedRight
    if (!isRightDraggingRef.current && Math.abs(clampedRight - props.rightRailWidth) >= 1) {
      props.setRightRailWidth(clampedRight)
    }
  }

  const onLeftDragStateChange = (isDragging: boolean) => {
    isLeftDraggingRef.current = isDragging
    if (isDragging) return
    if (!props.isSidebarOpen) return
    const clampedSidebar = pendingSidebarPercentRef.current
    if (Math.abs(clampedSidebar - props.sidebarWidth) >= 1) {
      props.setSidebarWidth(clampedSidebar)
    }
  }

  const onRightDragStateChange = (isDragging: boolean) => {
    isRightDraggingRef.current = isDragging
    if (isDragging) return
    const clampedRight = pendingRightRailPercentRef.current
    if (Math.abs(clampedRight - props.rightRailWidth) >= 1) {
      props.setRightRailWidth(clampedRight)
    }
  }

  return (
    <div data-testid="app-shell" className="h-screen w-screen min-w-0 bg-sidebar overflow-hidden ui-text-base relative">
      <ResizablePanelGroup
        direction="horizontal"
        className="h-full w-full"
      >
        <ResizablePanel
          defaultSize={props.isSidebarOpen ? sidebarPercent : 0}
          size={props.isSidebarOpen ? sidebarPercent : 0}
          minSize={props.isSidebarOpen ? sidebarMinPercent : 0}
          maxSize={props.isSidebarOpen ? sidebarMaxPercent : 0}
          onResize={onLeftResize}
          className={cn('bg-sidebar overflow-hidden', !props.isSidebarOpen && 'pointer-events-none')}
        >
          <div
            data-testid="left-rail"
            className={cn(
              'transition-opacity duration-200 ease-out h-full w-full overflow-hidden bg-sidebar',
              props.isSidebarOpen ? 'opacity-100' : 'opacity-0',
            )}
          >
            <LeftRail
              threads={props.sortedThreads}
              selectedCwd={props.selectedCwd}
              onSelectCwd={props.onSelectCwd}
              activeThreadId={props.activeThreadId}
              onSelectThread={props.onSelectThread}
              onRenameThread={props.onRenameThread}
              onArchiveThread={props.onArchiveThread}
              onStartThread={props.onStartThread}
              onStartThreadInCwd={props.onStartThreadInCwd}
              isBusy={props.isThreadActionBusy}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle
          className={cn(
            'relative z-[120]',
            !props.isSidebarOpen && 'pointer-events-none opacity-0',
          )}
          onDragging={onLeftDragStateChange}
        />

        <ResizablePanel defaultSize={100 - (props.isSidebarOpen ? sidebarPercent : 0)} minSize={35}>
          <div
            className={cn(
              'h-full min-w-0 flex flex-col',
              props.isSidebarOpen
                ? 'rounded-l-[22px] bg-background overflow-hidden'
                : 'bg-background',
            )}
          >
            <header className="h-14 flex-none border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
              <div className="h-full min-w-0 flex items-center px-4">
                <div className="flex-1 min-w-0 flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => props.setIsSidebarOpen(!props.isSidebarOpen)}
                    aria-label="Toggle sidebar"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex flex-col leading-tight">
                    <div className="truncate ui-text-base font-semibold text-foreground">{props.activeThreadTitle}</div>
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  {showDevLoadAllButton ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="header-dev-load-all-earlier"
                      className="h-8 px-2 ui-text-meta text-muted-foreground hover:text-foreground"
                      onClick={() => props.onDevLoadAllEarlier?.()}
                      disabled={!props.activeThreadId || !props.onDevLoadAllEarlier || props.devLoadAllRunning}
                    >
                      {props.devLoadAllRunning ? 'Loading all earlier...' : 'Load all earlier (Dev)'}
                    </Button>
                  ) : null}
                  {props.activeTurnId ? (
                    <div className="rounded-full border border-border bg-background px-2.5 py-1 ui-text-meta font-medium text-muted-foreground">
                      turn {props.activeTurnId.slice(0, 8)}
                    </div>
                  ) : null}
                  <div className="rounded-full bg-muted px-2.5 py-1 ui-text-meta font-medium text-muted-foreground">
                    {props.connectionStatus}
                  </div>
                </div>
              </div>
            </header>

            <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 min-w-0">
              <ResizablePanel defaultSize={centerPercent} minSize={35}>
                <div data-testid="center-pane-host" className="h-full min-w-0 relative flex flex-col">
                  {props.noticeMessage ? (
                    <div className="pointer-events-none absolute left-1/2 top-3 z-40 w-[min(560px,calc(100%-1.5rem))] -translate-x-1/2">
                      <Alert className="pointer-events-auto border-border/70 bg-background/95 shadow-sm backdrop-blur">
                        <AlertTitle>Session archived</AlertTitle>
                        <AlertDescription>{props.noticeMessage}</AlertDescription>
                      </Alert>
                    </div>
                  ) : null}
                  <TranscriptPane
                    activeThread={props.activeThread}
                    activeThreadId={props.activeThreadId}
                    activeTurnId={props.activeTurnId}
                    composerLocked={props.composerLocked}
                    virtualizationEnabled={props.transcriptVirtualizationEnabled}
                    logs={props.logs}
                    inputText={props.inputText}
                    mode={props.mode}
                    onModeChange={props.onModeChange}
                    connectionStatus={props.connectionStatus}
                    onInputTextChange={props.onInputTextChange}
                    onSend={props.onSend}
                    onInterrupt={props.onInterrupt}
                    historyMore={props.historyMore}
                    historyLoading={props.historyLoading}
                    onLoadEarlier={props.onLoadEarlier}
                    devLoadAllActive={props.devLoadAllRunning === true}
                    isSending={props.isSending}
                    isInterrupting={props.isInterrupting}
                    lastRpcError={props.lastRpcError}
                  />
                  <InputApprovalDock
                    input={props.selectedInput}
                    isAskOpen={props.isSelectedAskOpen}
                    askPageIndex={props.selectedAskPageIndex}
                    askDraftValues={props.selectedAskDraft}
                    submitStatus={props.submitStatus}
                    isSubmitting={props.isSubmittingInput}
                    onAskOpen={props.onAskOpen}
                    onAskDismiss={props.onAskDismiss}
                    onAskPageChange={props.onAskPageChange}
                    onAskDraftChange={props.onAskDraftChange}
                    onSubmitInput={props.onSubmitInput}
                  />
                </div>
              </ResizablePanel>

              <ResizableHandle
                className="relative z-[120] w-0 after:left-0 after:w-3 after:translate-x-0"
                onDragging={onRightDragStateChange}
              />

              <ResizablePanel
                defaultSize={rightRailPercent}
                minSize={rightRailMinPercent}
                maxSize={rightRailMaxPercent}
                onResize={onRightResize}
              >
                <div
                  data-testid="right-rail"
                  className="h-full min-w-0 bg-background border-l border-border/70 overflow-hidden overflow-x-hidden"
                >
                  <WorktreeDiffPane
                    diffSnapshot={props.diffSnapshot}
                    onRefreshDiff={props.onRefreshDiff}
                    onRequestPatch={props.onRequestDiffPatch}
                    isRefreshingDiff={props.isRefreshingDiff}
                    showHeader
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
