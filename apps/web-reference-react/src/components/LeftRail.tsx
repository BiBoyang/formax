import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Circle, Ellipsis, Folder, FolderOpen, SquarePen } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ThreadSummary } from '../types'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'

export type LeftRailProps = {
  connectionStatus?: 'disconnected' | 'connecting' | 'connected'
  bridgeUrl?: string
  onBridgeUrlChange?: (value: string) => void
  resumeThreadId?: string
  onResumeThreadIdChange?: (value: string) => void
  onRefreshThreads?: () => void
  onResumeThread?: () => void
  threads: ThreadSummary[]
  selectedCwd: string | null
  onSelectCwd: (cwd: string) => void
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onRenameThread?: (threadId: string, label: string) => Promise<void> | void
  onStartThread: () => void
  isBusy?: boolean
}

function threadTitle(thread: ThreadSummary): string {
  const label = thread.label?.trim()
  if (label) return label
  const prompt = thread.lastUserPrompt?.trim()
  if (prompt) return prompt
  return 'New Thread'
}

function relativeTime(updatedAt: string): string {
  const ts = Date.parse(updatedAt)
  if (!Number.isFinite(ts)) return '--'
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function groupThreadsByCwd(threads: ThreadSummary[]): Array<{ cwd: string; threads: ThreadSummary[] }> {
  const groupMap = new Map<string, ThreadSummary[]>()
  const groupOrder: string[] = []
  for (const thread of threads) {
    const cwd = thread.cwd
    if (!groupMap.has(cwd)) {
      groupMap.set(cwd, [thread])
      groupOrder.push(cwd)
      continue
    }
    groupMap.get(cwd)?.push(thread)
  }
  return groupOrder.map((cwd) => ({ cwd, threads: groupMap.get(cwd) ?? [] }))
}

function cwdLabel(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized) return cwd
  const parts = normalized.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : normalized
}

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
  await navigator.clipboard.writeText(text)
}

export function LeftRail(props: LeftRailProps) {
  const {
    threads,
    selectedCwd,
    onSelectCwd,
    activeThreadId,
    connectionStatus,
    onSelectThread,
    onRenameThread,
    onStartThread,
    isBusy = false,
  } = props
  const groupedThreads = useMemo(() => groupThreadsByCwd(threads), [threads])
  const activeThread = activeThreadId ? threads.find((thread) => thread.id === activeThreadId) : null
  const activeThreadCwd = activeThread?.cwd ?? null
  const [openByCwd, setOpenByCwd] = useState<Record<string, boolean>>({})
  const [openMenuThreadId, setOpenMenuThreadId] = useState<string | null>(null)
  const [renameThreadTarget, setRenameThreadTarget] = useState<ThreadSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)

  useEffect(() => {
    setOpenByCwd((previous) => {
      const next = { ...previous }
      let changed = false
      for (const group of groupedThreads) {
        if (next[group.cwd] != null) continue
        next[group.cwd] = true
        changed = true
      }
      return changed ? next : previous
    })
  }, [groupedThreads])

  const closeRenameDialog = () => {
    if (isRenaming) return
    setRenameThreadTarget(null)
    setRenameValue('')
  }

  const openRenameDialog = (thread: ThreadSummary) => {
    setRenameThreadTarget(thread)
    setRenameValue(thread.label?.trim() || threadTitle(thread))
  }

  const submitRename = async () => {
    if (!renameThreadTarget || !onRenameThread) return
    const nextLabel = renameValue.trim()
    if (!nextLabel) return
    setIsRenaming(true)
    try {
      await onRenameThread(renameThreadTarget.id, nextLabel)
      setRenameThreadTarget(null)
      setRenameValue('')
    } catch {
      // Keep dialog open so users can retry after transient RPC failures.
    } finally {
      setIsRenaming(false)
    }
  }

  return (
    <aside className="flex flex-col h-screen flex-none w-full border-r bg-sidebar overflow-hidden">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col min-h-full">
          <div className="px-2 pt-4 space-y-0.5 flex-none">
            {connectionStatus ? <div className="px-3 pb-2 text-xs text-muted-foreground">{connectionStatus}</div> : null}
            <Button
              variant="ghost"
              className="w-full justify-start h-9 px-3 text-[14px] font-medium text-foreground/80 hover:bg-muted/40"
              onClick={onStartThread}
              disabled={isBusy}
            >
              <SquarePen className="mr-3 h-4 w-4 opacity-70" />
              New thread
            </Button>
          </div>

          <div className="flex-1 flex flex-col mt-4 pb-12">
            <div className="px-5 py-2 text-[12px] font-medium text-muted-foreground/50 tracking-wide flex-none">Threads</div>

            <div className="space-y-0.5 px-2">
              {groupedThreads.length === 0 ? <div className="px-4 py-4 text-xs text-muted-foreground/60 italic">No recent threads</div> : null}
              {groupedThreads.map((group) => {
                const isSelectedGroup = selectedCwd === group.cwd || (!selectedCwd && activeThreadCwd === group.cwd)
                const isExpanded = openByCwd[group.cwd] ?? true
                return (
                  <Collapsible
                    key={group.cwd}
                    open={isExpanded}
                    onOpenChange={(open) => setOpenByCwd((previous) => ({ ...previous, [group.cwd]: open }))}
                    className="space-y-0.5"
                  >
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className={cn(
                          'w-full justify-start h-9 px-3 text-[13px] font-medium transition-all group/folder',
                          isSelectedGroup ? 'bg-muted/50 text-foreground' : 'text-foreground/65 hover:bg-muted/35',
                        )}
                        onClick={() => onSelectCwd(group.cwd)}
                        title={group.cwd}
                      >
                        <span className="relative mr-2 h-3.5 w-3.5">
                          <ChevronDown className="absolute inset-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover/folder:opacity-70" />
                          {isExpanded ? (
                            <FolderOpen className="absolute inset-0 h-3.5 w-3.5 opacity-60 transition-opacity group-hover/folder:opacity-0" />
                          ) : (
                            <Folder className="absolute inset-0 h-3.5 w-3.5 opacity-60 transition-opacity group-hover/folder:opacity-0" />
                          )}
                        </span>
                        <span className="truncate flex-1 text-left">{cwdLabel(group.cwd)}</span>
                      </Button>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      {group.threads.map((thread) => {
                        const isActive = activeThreadId === thread.id
                        return (
                          <div
                            key={thread.id}
                            className={cn(
                              'w-full h-9 flex items-center rounded-md transition-all group/thread',
                              isActive ? 'bg-muted/60 text-foreground' : 'text-foreground/70 hover:bg-muted/40',
                            )}
                          >
                            <Button
                              variant="ghost"
                              className={cn(
                                'h-9 min-w-0 flex-1 justify-between pl-8 pr-2 font-normal text-[13.5px] transition-all hover:bg-transparent',
                                isActive ? 'font-medium text-foreground' : 'text-foreground/70',
                              )}
                              onClick={() => onSelectThread(thread.id)}
                            >
                              <span className="min-w-0 flex-1 truncate text-left">{threadTitle(thread)}</span>
                              <div className="ml-2 flex w-14 flex-none items-center justify-end opacity-50">
                                <span className="inline-flex h-2 w-2 items-center justify-center">
                                  {thread.id === activeThreadId ? (
                                    <Circle className="h-1.5 w-1.5 fill-emerald-500 text-emerald-500" />
                                  ) : null}
                                </span>
                                <span className="w-10 text-right text-[11px] font-mono">{relativeTime(thread.updatedAt)}</span>
                              </div>
                            </Button>

                            <DropdownMenu
                              open={openMenuThreadId === thread.id}
                              onOpenChange={(open) => setOpenMenuThreadId(open ? thread.id : null)}
                            >
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className={cn(
                                    'h-7 w-7 mr-1 p-0 opacity-0 transition-opacity',
                                    'group-hover/thread:opacity-100 data-[state=open]:opacity-100',
                                  )}
                                  aria-label="Thread actions"
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setOpenMenuThreadId((current) => (current === thread.id ? null : thread.id))
                                  }}
                                >
                                  <Ellipsis className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" sideOffset={6}>
                                <DropdownMenuItem
                                  disabled={!onRenameThread}
                                  onSelect={(event) => {
                                    event.preventDefault()
                                    setOpenMenuThreadId(null)
                                    openRenameDialog(thread)
                                  }}
                                >
                                  Rename thread
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setOpenMenuThreadId(null)
                                    void copyToClipboard(thread.cwd).catch(() => undefined)
                                  }}
                                >
                                  Copy working directory
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setOpenMenuThreadId(null)
                                    void copyToClipboard(thread.id).catch(() => undefined)
                                  }}
                                >
                                  Copy session ID
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(renameThreadTarget)} onOpenChange={(open) => (open ? undefined : closeRenameDialog())}>
        <DialogContent className="sm:max-w-[560px]">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submitRename()
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename thread</DialogTitle>
              <DialogDescription>Keep it short and recognizable.</DialogDescription>
            </DialogHeader>
            <Input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              placeholder="Thread title"
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeRenameDialog} disabled={isRenaming}>
                Cancel
              </Button>
              <Button type="submit" disabled={!renameValue.trim() || isRenaming}>
                {isRenaming ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
