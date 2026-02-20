import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Folder, FolderOpen, SquarePen } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ThreadViewModel } from '../app/core/threadViewModel'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu'
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
  threads: ThreadViewModel[]
  selectedCwd: string | null
  onSelectCwd: (cwd: string) => void
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onRenameThread?: (threadId: string, label: string) => Promise<void> | void
  onArchiveThread?: (threadId: string) => Promise<void> | void
  onStartThread: () => void
  isBusy?: boolean
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

function groupThreadsByCwd(threads: ThreadViewModel[]): Array<{ cwd: string; threads: ThreadViewModel[] }> {
  const groupMap = new Map<string, ThreadViewModel[]>()
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
    onArchiveThread,
    onStartThread,
    isBusy = false,
  } = props
  const groupedThreads = useMemo(() => groupThreadsByCwd(threads), [threads])
  const activeThread = activeThreadId ? threads.find((thread) => thread.id === activeThreadId) : null
  const activeThreadCwd = activeThread?.cwd ?? null
  const [openByCwd, setOpenByCwd] = useState<Record<string, boolean>>({})
  const [renameThreadTarget, setRenameThreadTarget] = useState<ThreadViewModel | null>(null)
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

  const openRenameDialog = (thread: ThreadViewModel) => {
    setRenameThreadTarget(thread)
    setRenameValue(thread.label?.trim() || thread.title)
  }

  const handleRenameFromContextMenu = (thread: ThreadViewModel) => {
    if (!onRenameThread) return
    openRenameDialog(thread)
  }

  const handleCopyContextCwd = (thread: ThreadViewModel) => {
    void copyToClipboard(thread.cwd).catch(() => undefined)
  }

  const handleCopyContextThreadId = (thread: ThreadViewModel) => {
    void copyToClipboard(thread.id).catch(() => undefined)
  }

  const handleArchiveFromContextMenu = (thread: ThreadViewModel) => {
    if (!onArchiveThread) return
    void onArchiveThread(thread.id)
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
    <aside className="flex flex-col h-screen flex-none w-full bg-sidebar overflow-hidden">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col min-h-full">
          <div className="px-2 pt-4 space-y-0.5 flex-none">
            {connectionStatus ? <div className="px-3 pb-2 ui-text-meta ui-text-muted">{connectionStatus}</div> : null}
            <Button
              variant="ghost"
              className="w-full justify-start h-9 px-3 ui-text-base font-medium ui-text-secondary hover:bg-muted/40"
              onClick={onStartThread}
              disabled={isBusy}
            >
              <SquarePen className="mr-3 h-4 w-4 opacity-70" />
              New thread
            </Button>
          </div>

          <div className="flex-1 flex flex-col mt-4 pb-12">
            <div className="px-5 py-2 ui-text-base font-medium ui-text-muted tracking-wide flex-none">Threads</div>

            <div className="space-y-0.5 px-2">
              {groupedThreads.length === 0 ? <div className="px-4 py-4 ui-text-meta ui-text-muted italic">No recent threads</div> : null}
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
                          'w-full justify-start h-9 px-3 ui-text-base font-normal transition-colors group/folder',
                          isSelectedGroup ? 'ui-surface-subtle ui-text-secondary' : 'ui-text-muted hover:bg-muted/30',
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
                          <ContextMenu key={thread.id}>
                            <ContextMenuTrigger asChild>
                              <div
                                className={cn(
                                  'relative w-full h-9 flex items-center rounded-md transition-colors group/thread',
                                  isActive
                                    ? 'ui-surface-selected text-foreground shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]'
                                    : 'ui-text-secondary hover:bg-[var(--surface-subtle)]',
                                )}
                              >
                              <Button
                                variant="ghost"
                                className={cn(
                                  'h-9 min-w-0 w-full justify-start gap-2 pl-6 pr-2 font-normal ui-text-base transition-none hover:bg-transparent',
                                  isActive ? 'ui-text-primary' : 'ui-text-secondary',
                                )}
                                onClick={() => onSelectThread(thread.id)}
                              >
                                <span className="min-w-0 flex-1 truncate text-left">{thread.title}</span>
                                <span className={cn('shrink-0 text-right ui-text-meta font-mono tabular-nums', isActive ? 'text-foreground/84' : 'text-foreground/74')}>
                                  {relativeTime(thread.updatedAt)}
                                </span>
                              </Button>
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                                <ContextMenuItem
                                  disabled={!onRenameThread}
                                  onSelect={() => handleRenameFromContextMenu(thread)}
                                >
                                  Rename thread
                                </ContextMenuItem>
                                <ContextMenuItem
                                  disabled={!onArchiveThread || isBusy}
                                  onSelect={() => handleArchiveFromContextMenu(thread)}
                                >
                                  Archive thread
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  onSelect={() => handleCopyContextCwd(thread)}
                                >
                                  Copy working directory
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() => handleCopyContextThreadId(thread)}
                                >
                                  Copy session ID
                                </ContextMenuItem>
                              </ContextMenuContent>
                          </ContextMenu>
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
