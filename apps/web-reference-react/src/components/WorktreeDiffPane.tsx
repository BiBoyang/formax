import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from './ui/scroll-area'
import { cn } from '../lib/utils'
import { shouldStopWheelPropagation } from './scrollBoundary'

type DiffFile = {
  path: string
  additions: number
  deletions: number
  patch: string
  untracked?: boolean
}

export type DiffSnapshot = {
  cwd: string
  generatedAt: string
  hasChanges: boolean
  truncated: boolean
  files: DiffFile[]
}

type DiffRow = {
  kind: 'meta' | 'add' | 'del' | 'ctx'
  text: string
  oldLine: number | null
  newLine: number | null
}

export type WorktreeDiffPaneProps = {
  diffSnapshot?: DiffSnapshot | null
  onRefreshDiff?: () => void
  isRefreshingDiff?: boolean
  showHeader?: boolean
}

function parsePatchRows(patch: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (m) {
        oldLine = Number(m[1])
        newLine = Number(m[2])
        inHunk = true
      }
      rows.push({ kind: 'meta', text: line.replace(/^@@.*?@@\s?/, '').trim() || '···', oldLine: null, newLine: null })
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      rows.push({ kind: 'add', text: line, oldLine: null, newLine })
      newLine += 1
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      rows.push({ kind: 'del', text: line, oldLine, newLine: null })
      oldLine += 1
    } else if (inHunk && !line.startsWith('\\')) {
      rows.push({ kind: 'ctx', text: line, oldLine, newLine })
      oldLine += 1
      newLine += 1
    }
  }
  return rows
}

function DiffPatchView({ file }: { file: DiffFile }) {
  const rows = parsePatchRows(file.patch)
  return (
    <div className="bg-white rounded-b-[10px] overflow-hidden">
      <div className="max-h-[1200px] min-w-0 overflow-x-hidden font-mono text-[12px] leading-relaxed">
        {rows.map((row, index) => (
          <div key={index} className={cn(
              "grid grid-cols-[48px_minmax(0,1fr)] relative group/line",
              row.kind === 'add' && "bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07]",
              row.kind === 'del' && "bg-red-500/[0.04] hover:bg-red-500/[0.07]",
              row.kind === 'meta' && "bg-muted/30 text-muted-foreground/40 italic text-[11px] py-1"
          )}>
            {(row.kind === 'add' || row.kind === 'del') && (
                <div className={cn("absolute left-0 top-0 bottom-0 w-[4px]", row.kind === 'add' ? "bg-emerald-500/60" : "bg-red-500/60")} />
            )}
            <div className="select-none px-2 text-right text-muted-foreground/30 text-[10px] flex items-center justify-end border-r border-border/10">
              {row.kind === 'del' ? row.oldLine : (row.newLine ?? '')}
            </div>
            <div className={cn("min-w-0 px-4 flex items-start", row.kind === 'add' && "text-emerald-700/90", row.kind === 'del' && "text-red-700/90")}>
              <span className="opacity-30 mr-3 w-2 shrink-0 select-none text-[13px]">
                {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all py-0.5">
                {row.text.startsWith('+') || row.text.startsWith('-') ? row.text.slice(1) : row.text}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

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
              <div className="space-y-[8px] pt-1">
                {files.map((file) => {
                  const open = Boolean(openFiles[file.path])
                  return (
                    <div key={file.path} className="flex min-w-0 flex-col group relative">
                      <button
                        className={cn(
                          "flex min-w-0 items-center justify-between w-full text-left px-5 py-[11px] transition-all sticky top-0 z-[20]",
                          "bg-[#F3F4F6] hover:bg-[#EDEFF2]",
                          open ? "rounded-t-[10px]" : "rounded-[10px]"
                        )}
                        onClick={() => setOpenFiles((prev) => ({ ...prev, [file.path]: !open }))}
                      >
                        <div className="flex items-center gap-x-2.5 min-w-0 flex-1">
                          <span className="font-mono text-[12px] text-foreground/60 group-hover:text-foreground/80 transition-colors truncate [overflow-wrap:anywhere] tracking-[-0.01em]">
                            {file.path}
                          </span>
                          <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold shrink-0">
                            <span className="text-emerald-500">+{file.additions}</span>
                            <span className="text-red-500">-{file.deletions}</span>
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
                      {open ? <DiffPatchView file={file} /> : null}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </aside>
  )
}
