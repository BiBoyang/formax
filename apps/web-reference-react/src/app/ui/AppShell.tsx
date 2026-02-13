import type { Dispatch, FormEvent, MouseEvent as ReactMouseEvent, SetStateAction } from 'react'
import { PanelLeft } from 'lucide-react'
import { InputApprovalDock } from '../../components/InputApprovalDock'
import { LeftRail } from '../../components/LeftRail'
import { TranscriptPane } from '../../components/TranscriptPane'
import { WorktreeDiffPane, type DiffSnapshot } from '../../components/WorktreeDiffPane'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/utils'
import type { PendingInput, ThreadSummary, TranscriptItem } from '../../types'
import type { ReplMode } from '../../../../../src/features/semantics/replModeTransition'
import { clampRightRailWidth, clampSidebarWidth } from './usePaneLayout'

export type AppShellProps = {
  sortedThreads: ThreadSummary[]
  selectedCwd: string | null
  onSelectCwd: (cwd: string) => void
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onRenameThread: (threadId: string, label: string) => void
  onStartThread: () => void
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
  isRefreshingDiff: boolean
}

export function AppShell(props: AppShellProps) {
  const onStartSidebarResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    const startX = event.pageX
    const startWidth = props.sidebarWidth

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.pageX - startX
      const newWidth = clampSidebarWidth(startWidth + deltaX, window.innerWidth, props.rightRailWidth)
      props.setSidebarWidth(newWidth)
      props.setRightRailWidth((previous) => clampRightRailWidth(previous, window.innerWidth, true, newWidth))
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = 'default'
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
  }

  const onStartRightRailResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    const startX = event.pageX
    const startWidth = props.rightRailWidth

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.pageX
      const newWidth = clampRightRailWidth(startWidth + deltaX, window.innerWidth, props.isSidebarOpen, props.sidebarWidth)
      props.setRightRailWidth(newWidth)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = 'default'
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
  }

  return (
    <div data-testid="app-shell" className="h-screen w-screen min-w-0 flex bg-background overflow-hidden text-sm relative">
      <div
        data-testid="left-rail"
        className={cn(
          'transition-all duration-300 ease-in-out h-full overflow-hidden bg-sidebar flex-none relative',
          props.isSidebarOpen ? 'opacity-100' : 'w-0 opacity-0',
        )}
        style={{ width: props.isSidebarOpen ? props.sidebarWidth : 0 }}
      >
        <LeftRail
          threads={props.sortedThreads}
          selectedCwd={props.selectedCwd}
          onSelectCwd={props.onSelectCwd}
          activeThreadId={props.activeThreadId}
          onSelectThread={props.onSelectThread}
          onRenameThread={props.onRenameThread}
          onStartThread={props.onStartThread}
          isBusy={props.isThreadActionBusy}
        />

        {props.isSidebarOpen ? (
          <div
            className="absolute right-0 top-0 bottom-0 w-[1px] cursor-col-resize hover:bg-primary/50 bg-border z-[110]"
            onMouseDown={onStartSidebarResize}
          >
            <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-w-0 h-full flex flex-col">
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
                <div className="truncate text-[14px] font-semibold text-foreground">{props.activeThreadTitle}</div>
              </div>
            </div>
            <div className="ml-3 flex shrink-0 items-center gap-2">
              {props.activeTurnId ? (
                <div className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  turn {props.activeTurnId.slice(0, 8)}
                </div>
              ) : null}
              <div className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                {props.connectionStatus}
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 min-w-0 flex">
          <div data-testid="center-pane-host" className="flex-1 flex flex-col relative h-full min-w-0">
            <TranscriptPane
              activeThread={props.activeThread}
              activeThreadId={props.activeThreadId}
              activeTurnId={props.activeTurnId}
              composerLocked={props.composerLocked}
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

          <div
            className="w-[1px] h-full flex-none cursor-col-resize hover:bg-primary/50 bg-border relative group z-[100]"
            onMouseDown={onStartRightRailResize}
          >
            <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
          </div>

          <div
            data-testid="right-rail"
            className="flex-none min-w-0 bg-white h-full overflow-hidden overflow-x-hidden"
            style={{ width: props.rightRailWidth }}
          >
            <WorktreeDiffPane
              diffSnapshot={props.diffSnapshot}
              onRefreshDiff={props.onRefreshDiff}
              isRefreshingDiff={props.isRefreshingDiff}
              showHeader
            />
          </div>
        </div>
      </div>
    </div>
  )
}
