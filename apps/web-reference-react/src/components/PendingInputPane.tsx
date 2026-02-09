import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { PendingInput } from '../types'
import { ScrollArea } from './ui/scroll-area'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { ApprovalForm, QuestionForm, formatRemainingTime, statusVariant } from './InputForms'

type DiffFile = {
  path: string
  additions: number
  deletions: number
  patch: string
  untracked?: boolean
}

type DiffSnapshot = {
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

export type PendingInputPaneProps = {
  pendingInputs: Record<string, PendingInput>
  selectedInputId: string | null
  onSelectInput: (inputId: string) => void
  onSubmitInput: (answers: Record<string, string>) => void
  submitStatusByInputId?: Record<string, { status: string; kind: 'success' | 'error'; message?: string }>
  isSubmitting?: boolean
  diffSnapshot?: DiffSnapshot | null
  onRefreshDiff?: () => void
  isRefreshingDiff?: boolean
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
      <div className="max-h-[1200px] font-mono text-[12px] leading-relaxed">
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
            <div className={cn("px-4 flex items-start", row.kind === 'add' && "text-emerald-700/90", row.kind === 'del' && "text-red-700/90")}>
                <span className="opacity-30 mr-3 w-2 shrink-0 select-none text-[13px]">
                    {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
                </span>
                <span className="flex-1 whitespace-pre truncate py-0.5">{row.text.startsWith('+') || row.text.startsWith('-') ? row.text.slice(1) : row.text}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PendingInputPane(props: PendingInputPaneProps) {
  const {
    pendingInputs,
    selectedInputId,
    onSelectInput,
    onSubmitInput,
    submitStatusByInputId = {},
    isSubmitting = false,
    diffSnapshot = null,
    onRefreshDiff,
    isRefreshingDiff = false,
  } = props
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({})
  const [listOpen, setListOpen] = useState(true)
  const files = diffSnapshot?.files ?? []
  const selectedInput = selectedInputId ? pendingInputs[selectedInputId] : null
  const selectedSubmitStatus = selectedInput ? submitStatusByInputId[selectedInput.inputId] : null
  const remainingText = selectedInput ? formatRemainingTime(selectedInput.expiresAt, Date.now()) : null

  return (
    <aside className="h-full w-full flex flex-col overflow-hidden bg-white selection:bg-primary/10">
      {/* Target Header */}
      <div className="flex-none flex items-center justify-between px-6 h-14 bg-white z-[30]">
          <div className="flex items-center gap-1.5 cursor-pointer select-none" onClick={() => setListOpen(!listOpen)}>
              <h2 className="text-[13px] font-semibold text-foreground/85">Uncommitted worktree changes</h2>
              <ChevronDown className={cn("size-3.5 text-muted-foreground/50 transition-transform", !listOpen && "-rotate-90")} />
          </div>

          <div className="flex items-center gap-4">
              <div className="flex items-center gap-2.5 text-muted-foreground/35">
                  <span className="text-[11px] text-muted-foreground/70">Changes: {files.length}</span>
                  <RefreshCw 
                    className={cn("size-3.5 hover:text-foreground/60 transition-all cursor-pointer", isRefreshingDiff && "animate-spin")} 
                    onClick={(e) => { e.stopPropagation(); onRefreshDiff?.() }}
                  />
              </div>
          </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 relative">
          <ScrollArea className="h-full px-6 pb-20">
              <div className="relative">
                  {/* 
                      PURE CSS LEAK FIX: 
                      A white sticky mask that sits behind the Sticky Headers (z-20) 
                      but in front of the list content (z-0). 
                      It prevents colors from leaking through the rounded corners.
                  */}
                  <div className="sticky top-0 h-4 w-full bg-white z-[15] -mt-1 pointer-events-none" />

                  {listOpen && (
                      <div className="space-y-[8px] pt-1">
                          {files.map((file) => {
                              const open = Boolean(openFiles[file.path])
                              return (
                                  <div key={file.path} className="flex flex-col group relative">
                                      <button
                                          className={cn(
                                              "flex items-center justify-between w-full text-left px-5 py-[11px] transition-all sticky top-0 z-[20]",
                                              "bg-[#F3F4F6] hover:bg-[#EDEFF2]",
                                              open ? "rounded-t-[10px]" : "rounded-[10px]"
                                          )}
                                          onClick={() => setOpenFiles(prev => ({ ...prev, [file.path]: !open }))}
                                      >
                                          <div className="flex items-center gap-x-2.5 min-w-0 flex-1">
                                              <span className="font-mono text-[12px] text-foreground/60 group-hover:text-foreground/80 transition-colors truncate tracking-[-0.01em]">
                                                  {file.path}
                                              </span>
                                              <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold shrink-0">
                                                  <span className="text-emerald-500">+{file.additions}</span>
                                                  <span className="text-red-500">-{file.deletions}</span>
                                                  {file.untracked && <div className="size-1.5 rounded-full bg-blue-500 ml-1" />}
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
                                      {open && <DiffPatchView file={file} />}
                                  </div>
                              )
                          })}
                      </div>
                  )}
              </div>
          </ScrollArea>
      </div>

      {/* Pending Inputs Area */}
      {Object.values(pendingInputs).length > 0 && (
          <div className="flex-none border-t bg-white pt-2 pb-6 shadow-[-10px_0_20px_rgba(0,0,0,0.02)] z-30">
              <div className="px-6 py-2 flex items-center justify-between">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Pending Inputs</h3>
                  <div className="size-5 rounded-full bg-muted/60 flex items-center justify-center text-[10px] font-bold text-muted-foreground/60">{Object.values(pendingInputs).length}</div>
              </div>
              <div className="px-5 space-y-1.5 mt-2">
                  {Object.values(pendingInputs).map(input => (
                      <button 
                        key={input.inputId}
                        onClick={() => onSelectInput(input.inputId)}
                        className={cn(
                            "w-full text-left px-5 py-4 rounded-xl border transition-all",
                            selectedInputId === input.inputId 
                            ? "bg-white border-primary/20 shadow-xl shadow-primary/5 ring-1 ring-primary/5" 
                            : "bg-[#F3F4F6]/50 border-transparent hover:bg-[#F3F4F6] text-muted-foreground/70"
                        )}
                      >
                         <div className="font-bold text-foreground/85 leading-snug text-[12px]">{input.kind === 'approval' ? 'Approval Required' : 'Question from Agent'}</div>
                         <div className="opacity-30 font-mono text-[10px] mt-1">{input.toolUseId}</div>
                      </button>
                  ))}
              </div>
              {selectedInput ? (
                <div className="px-5 pt-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-xs font-semibold">{selectedInput.kind === 'approval' ? 'Approval' : 'AskUserQuestion'}</h4>
                    <Badge variant="secondary">{selectedInput.status}</Badge>
                  </div>
                  <div className="mb-3 text-[11px] text-muted-foreground">Remaining: {remainingText}</div>
                  {selectedSubmitStatus ? (
                    <div className="mb-3 rounded-md border px-3 py-2 text-xs">
                      <Badge variant={statusVariant(selectedSubmitStatus.status, selectedSubmitStatus.kind)}>{selectedSubmitStatus.status}</Badge>
                    </div>
                  ) : null}
                  {selectedInput.kind === 'approval' ? (
                    <ApprovalForm input={selectedInput} onSubmit={onSubmitInput} isSubmitting={isSubmitting} remainingText={remainingText ?? 'expired'} />
                  ) : (
                    <QuestionForm input={selectedInput} onSubmit={onSubmitInput} isSubmitting={isSubmitting} remainingText={remainingText ?? 'expired'} />
                  )}
                </div>
              ) : null}
          </div>
      )}
    </aside>
  )
}
