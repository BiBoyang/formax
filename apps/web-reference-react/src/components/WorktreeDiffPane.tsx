import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from './ui/scroll-area'
import { cn } from '../lib/utils'
import { shouldStopWheelPropagation } from './scrollBoundary'
import { DiffPatchView } from './diff/DiffPatchView'
import { truncatePathFromLeft, type DiffFileViewModel } from './diff/diffTypes'

type DiffFile = DiffFileViewModel

export type DiffSnapshot = {
  cwd: string
  generatedAt: string
  hasChanges: boolean
  truncated: boolean
  files: DiffFile[]
}

export type WorktreeDiffPaneProps = {
  diffSnapshot?: DiffSnapshot | null
  onRefreshDiff?: () => void
  isRefreshingDiff?: boolean
  showHeader?: boolean
}

const MAX_RENDERABLE_DIFF_FILES = 120

export function WorktreeDiffPane(props: WorktreeDiffPaneProps) {
  const {
    diffSnapshot = null,
    onRefreshDiff,
    isRefreshingDiff = false,
    showHeader = true,
  } = props
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({})
  const [listOpen, setListOpen] = useState(true)
  const diffScrollAreaRef = useRef<HTMLDivElement | null>(null)
  const files = diffSnapshot?.files ?? []
  const isLargeChangeSet = Boolean(
    diffSnapshot &&
      diffSnapshot.hasChanges &&
      (diffSnapshot.truncated || files.length > MAX_RENDERABLE_DIFF_FILES),
  )

  useEffect(() => {
    const root = diffScrollAreaRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      if (
        shouldStopWheelPropagation({
          deltaY: event.deltaY,
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
        })
      ) {
        event.stopPropagation()
      }
    }
    viewport.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      viewport.removeEventListener('wheel', onWheel)
    }
  }, [files.length, listOpen])

  return (
    <aside data-testid="worktree-diff-pane" className="h-full w-full min-w-0 flex flex-col overflow-hidden overflow-x-hidden bg-white selection:bg-primary/10">
      {showHeader ? (
        <div className="flex-none flex items-center justify-between px-6 h-14 bg-white z-[30]">
          <div className="flex items-center gap-1.5 cursor-pointer select-none" onClick={() => setListOpen(!listOpen)}>
            <h2 className="text-[13px] font-semibold text-foreground/85">Uncommitted worktree changes</h2>
            <ChevronDown className={cn("size-3.5 text-muted-foreground/50 transition-transform", !listOpen && "-rotate-90")} />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5 text-muted-foreground/35">
              <span className="text-[11px] text-muted-foreground/70">Changes: {files.length}</span>
              <button
                type="button"
                aria-label="Refresh diff"
                className="inline-flex items-center justify-center rounded-md p-0.5"
                onClick={(e) => { e.stopPropagation(); onRefreshDiff?.() }}
              >
                <RefreshCw
                  className={cn("size-3.5 hover:text-foreground/60 transition-all cursor-pointer", isRefreshingDiff && "animate-spin")}
                />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 min-w-0 relative">
        <ScrollArea ref={diffScrollAreaRef} className="h-full min-w-0 px-6 pb-20">
          <div className="relative">
            <div className="sticky top-0 h-4 w-full bg-white z-[15] -mt-1 pointer-events-none" />

            {listOpen ? (
              !diffSnapshot ? null : isLargeChangeSet ? (
                <div className="min-h-[55vh] grid place-items-center">
                  <div className="text-center">
                    <h3 className="mt-4 text-[14px] font-semibold tracking-tight text-foreground/85">Change set too large to preview</h3>
                    <p className="mt-2 text-[14px] text-muted-foreground">Refine the scope to inspect file diffs here</p>
                  </div>
                </div>
              ) : files.length === 0 && !diffSnapshot.hasChanges ? (
                <div className="min-h-[55vh] grid place-items-center">
                  <div className="text-center">
                    <div className="text-[30px] leading-none">🧹</div>
                    <h3 className="mt-4 text-[14px] font-semibold tracking-tight text-foreground/85">No unstaged changes</h3>
                    <p className="mt-2 text-[16px] text-muted-foreground">Code changes will appear here</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 pt-1">
                  {files.map((file) => {
                    const open = Boolean(openFiles[file.path])
                    return (
                      <div key={file.path} className="flex min-w-0 flex-col group relative">
                        <button
                          data-testid={`diff-file-row-${file.path}`}
                        className={cn(
                          "flex min-w-0 items-center justify-between w-full text-left px-3.5 py-2 transition-colors",
                          "bg-sidebar-accent/55",
                          "border border-transparent",
                          open && "border-b-border/50",
                          open ? "rounded-t-[10px]" : "rounded-[10px]"
                        )}
                          onClick={() => setOpenFiles((prev) => ({ ...prev, [file.path]: !open }))}
                        >
                          <div className="flex items-center gap-x-2.5 min-w-0 flex-1">
                            <span
                              title={file.path}
                              className={cn(
                                "font-mono min-w-0 truncate text-[#1f2328] transition-colors",
                                open
                                  ? "text-[12.5px] leading-4 font-medium"
                                  : "text-[12.5px] leading-4 font-normal",
                              )}
                            >
                              {truncatePathFromLeft(file.path)}
                            </span>
                            <div className="flex items-center gap-1 text-[12px] leading-4 font-mono font-normal shrink-0">
                              <span className="text-[#00a86b]">+{file.additions}</span>
                              <span className="text-[#d63a3a]">-{file.deletions}</span>
                              {file.untracked ? <div className="size-1.5 rounded-full bg-blue-500 ml-1" /> : null}
                            </div>
                          </div>

                          <div className="flex items-center shrink-0 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
                            {open ? (
                              <ChevronDown className="size-4 text-muted-foreground/50" />
                            ) : (
                              <ChevronRight className="size-4 text-muted-foreground/45" />
                            )}
                          </div>
                        </button>
                        {open ? <DiffPatchView patch={file.patch} /> : null}
                      </div>
                    )
                  })}
                </div>
              )
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </aside>
  )
}
