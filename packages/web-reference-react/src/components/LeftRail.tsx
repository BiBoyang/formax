import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { ChevronDown, Clock3, Folder, FolderOpen, FolderPlus, Globe, MoreHorizontal, Settings, Sparkles, SquarePen, ArrowLeft, Monitor, Settings2, Palette, Server, GitBranch, TerminalSquare, FolderTree, ArchiveRestore } from 'lucide-react'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Input } from './ui/input'

const OPEN_BY_CWD_STORAGE_KEY = 'formax.web.leftRail.openByCwd.v1'

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
  onStartThreadInCwd: (cwd: string) => void
  hiddenGroupCwds: string[]
  onHideThreadGroup: (cwd: string) => void
  isBusy?: boolean
  isDesktopClient?: boolean
  onCreateProject?: () => Promise<void> | void
  isSidebarTransparent?: boolean
  onToggleSidebarTransparency?: (enabled: boolean) => void
  isSettingsOpen?: boolean
  onOpenSettings?: () => void
  onCloseSettings?: () => void
}

function readOpenByCwdFromStorage(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(OPEN_BY_CWD_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [cwd, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!cwd.trim()) continue
      if (typeof value !== 'boolean') continue
      out[cwd] = value
    }
    return out
  } catch {
    return {}
  }
}

function writeOpenByCwdToStorage(openByCwd: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(OPEN_BY_CWD_STORAGE_KEY, JSON.stringify(openByCwd))
  } catch {
    // Ignore storage quota/privacy errors and keep runtime state in-memory.
  }
}

function relativeTime(updatedAt: string, nowMs: number): string {
  const ts = Date.parse(updatedAt)
  if (!Number.isFinite(ts)) return '--'
  const minutes = Math.max(1, Math.floor((nowMs - ts) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

type LeftRailThreadGroup = {
  cwd: string
  folderName: string
  threads: ThreadViewModel[]
  sortLabel: string
  sortPath: string
}

function normalizeCwdPath(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '')
}

function groupThreadsByCwd(threads: ThreadViewModel[]): LeftRailThreadGroup[] {
  const groupMap = new Map<string, ThreadViewModel[]>()
  for (const thread of threads) {
    const cwd = thread.cwd
    if (!groupMap.has(cwd)) {
      groupMap.set(cwd, [thread])
      continue
    }
    groupMap.get(cwd)?.push(thread)
  }
  const groups: LeftRailThreadGroup[] = Array.from(groupMap.entries()).map(([cwd, grouped]) => {
    const folderName = cwdLabel(cwd)
    return {
      cwd,
      folderName,
      threads: grouped,
      sortLabel: folderName.toLowerCase(),
      sortPath: normalizeCwdPath(cwd).toLowerCase(),
    }
  })
  groups.sort((a, b) => {
    if (a.sortLabel !== b.sortLabel) return a.sortLabel < b.sortLabel ? -1 : 1
    if (a.sortPath === b.sortPath) return 0
    return a.sortPath < b.sortPath ? -1 : 1
  })
  return groups
}

function cwdLabel(cwd: string): string {
  const normalized = normalizeCwdPath(cwd)
  if (!normalized) return cwd
  const parts = normalized.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : normalized
}

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
  await navigator.clipboard.writeText(text)
}

type SuppressInteractionEvent = {
  preventDefault: () => void
  stopPropagation: () => void
}

type FolderHeaderRowProps = ComponentPropsWithoutRef<'div'> & {
  cwd: string
  folderName: string
  isExpanded: boolean
  canRemoveGroup: boolean
  isBusy: boolean
  onSelectCwd: (cwd: string) => void
  onMarkFolderRemoved: (cwd: string) => void
  onStartThreadInFolder: (cwd: string) => void
  suppressFolderAction: (event: SuppressInteractionEvent) => void
}

const FolderHeaderRow = forwardRef<HTMLDivElement, FolderHeaderRowProps>(function FolderHeaderRow(props, ref) {
  const {
    cwd,
    folderName,
    isExpanded,
    canRemoveGroup,
    isBusy,
    onSelectCwd,
    onMarkFolderRemoved,
    onStartThreadInFolder,
    suppressFolderAction,
    className,
    ...rest
  } = props

  return (
    <div
      ref={ref}
      {...rest}
      className={cn(
        'group/folder flex h-8 items-center rounded-md transition-colors ui-sidebar-folder-row',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        className="h-8 min-w-0 flex-1 justify-start px-3 ui-text-base font-normal transition-none hover:bg-transparent text-inherit"
        onClick={() => onSelectCwd(cwd)}
        title={cwd}
      >
        <span className="relative mr-2 h-3.5 w-3.5">
          <ChevronDown className="absolute inset-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover/folder:opacity-70" />
          {isExpanded ? (
            <FolderOpen className="absolute inset-0 h-3.5 w-3.5 opacity-60 transition-opacity group-hover/folder:opacity-0" />
          ) : (
            <Folder className="absolute inset-0 h-3.5 w-3.5 opacity-60 transition-opacity group-hover/folder:opacity-0" />
          )}
        </span>
        <span className="truncate flex-1 text-left">{folderName}</span>
      </Button>
      <div className="pointer-events-none mr-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/folder:opacity-100 group-focus-within/folder:opacity-100">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Folder actions for ${folderName}`}
              className="pointer-events-auto h-7 w-7 rounded-md text-muted-foreground/90 hover:bg-muted/50 hover:text-foreground"
              onClick={suppressFolderAction}
              onContextMenu={(event) => {
                event.stopPropagation()
              }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled>Create permanent worktree</ContextMenuItem>
            <ContextMenuItem disabled>Edit name</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!canRemoveGroup}
              onSelect={(event) => {
                event.preventDefault()
                onMarkFolderRemoved(cwd)
              }}
            >
              Remove session folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Start new thread in ${folderName}`}
          title={`Start new thread in ${folderName}`}
          disabled={isBusy}
          className="pointer-events-auto h-7 w-7 rounded-md text-muted-foreground/90 hover:bg-muted/50 hover:text-foreground"
          onClick={(event) => {
            suppressFolderAction(event)
            onStartThreadInFolder(cwd)
          }}
        >
          <SquarePen className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
})

const MemoFolderHeaderRow = memo(FolderHeaderRow)

type ThreadRowProps = {
  thread: ThreadViewModel
  isActive: boolean
  isBusy: boolean
  nowMsSnapshot: number
  canRenameThread: boolean
  canArchiveThread: boolean
  onSelectThread: (threadId: string) => void
  onRenameFromContextMenu: (thread: ThreadViewModel) => void
  onArchiveFromContextMenu: (thread: ThreadViewModel) => void
  onCopyContextCwd: (thread: ThreadViewModel) => void
  onCopyContextThreadId: (thread: ThreadViewModel) => void
}

const MemoThreadRow = memo(function ThreadRow(props: ThreadRowProps) {
  const {
    thread,
    isActive,
    isBusy,
    nowMsSnapshot,
    canRenameThread,
    canArchiveThread,
    onSelectThread,
    onRenameFromContextMenu,
    onArchiveFromContextMenu,
    onCopyContextCwd,
    onCopyContextThreadId,
  } = props

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-active={isActive ? 'true' : 'false'}
          className={cn(
            'relative w-full h-8 flex items-center rounded-md group/thread ui-sidebar-list-row',
          )}
        >
          <Button
            variant="ghost"
            className={cn(
              'h-8 min-w-0 w-full justify-start gap-2 pl-6 pr-2 font-normal ui-text-base transition-none hover:bg-transparent text-inherit',
            )}
            onClick={() => onSelectThread(thread.id)}
          >
            <span className="min-w-0 flex-1 truncate text-left">{thread.title}</span>
            <span className="shrink-0 text-right ui-text-meta font-mono tabular-nums ui-sidebar-list-row-time">
              {relativeTime(thread.updatedAt, nowMsSnapshot)}
            </span>
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!canRenameThread}
          onSelect={() => onRenameFromContextMenu(thread)}
        >
          Rename thread
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canArchiveThread || isBusy}
          onSelect={() => onArchiveFromContextMenu(thread)}
        >
          Archive thread
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => onCopyContextCwd(thread)}
        >
          Copy working directory
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => onCopyContextThreadId(thread)}
        >
          Copy session ID
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})

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
    onStartThreadInCwd,
    hiddenGroupCwds,
    onHideThreadGroup,
    isBusy = false,
    isDesktopClient = false,
    onCreateProject,
    isSidebarTransparent = false,
    onToggleSidebarTransparency,
    isSettingsOpen = false,
    onOpenSettings,
    onCloseSettings,
  } = props
  const groupedThreads = useMemo(() => groupThreadsByCwd(threads), [threads])
  const hiddenGroupCwdSet = useMemo(() => new Set(hiddenGroupCwds), [hiddenGroupCwds])
  const activeThread = useMemo(
    () => (activeThreadId ? threads.find((thread) => thread.id === activeThreadId) ?? null : null),
    [threads, activeThreadId],
  )
  const activeThreadCwd = activeThread?.cwd ?? null
  const [openByCwd, setOpenByCwd] = useState<Record<string, boolean>>(() => readOpenByCwdFromStorage())
  const persistedOpenByCwdRef = useRef(JSON.stringify(openByCwd))
  const [renameThreadTarget, setRenameThreadTarget] = useState<ThreadViewModel | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const nowMinuteBucket = Math.floor(Date.now() / 60_000)
  const nowMsSnapshot = useMemo(() => Date.now(), [nowMinuteBucket])
  const canRenameThread = Boolean(onRenameThread)
  const canArchiveThread = Boolean(onArchiveThread)
  const canCreateProject = Boolean(onCreateProject)
  const visibleGroupedThreads = useMemo(
    () => groupedThreads.filter((group) => !hiddenGroupCwdSet.has(group.cwd)),
    [groupedThreads, hiddenGroupCwdSet],
  )

  useEffect(() => {
    setOpenByCwd((previous) => {
      const next = { ...previous }
      let changed = false
      for (const group of visibleGroupedThreads) {
        if (next[group.cwd] != null) continue
        next[group.cwd] = true
        changed = true
      }
      return changed ? next : previous
    })
  }, [visibleGroupedThreads])

  useEffect(() => {
    const serialized = JSON.stringify(openByCwd)
    if (serialized === persistedOpenByCwdRef.current) return
    persistedOpenByCwdRef.current = serialized
    writeOpenByCwdToStorage(openByCwd)
  }, [openByCwd])

  const closeRenameDialog = useCallback(() => {
    if (isRenaming) return
    setRenameThreadTarget((previous) => (previous === null ? previous : null))
    setRenameValue((previous) => (previous === '' ? previous : ''))
  }, [isRenaming])

  const openRenameDialog = useCallback((thread: ThreadViewModel) => {
    const nextRenameValue = thread.label?.trim() || thread.title
    setRenameThreadTarget((previous) => (previous?.id === thread.id ? previous : thread))
    setRenameValue((previous) => (previous === nextRenameValue ? previous : nextRenameValue))
  }, [])

  const handleRenameFromContextMenu = useCallback((thread: ThreadViewModel) => {
    if (!onRenameThread) return
    openRenameDialog(thread)
  }, [onRenameThread, openRenameDialog])

  const handleCopyContextCwd = useCallback((thread: ThreadViewModel) => {
    void copyToClipboard(thread.cwd).catch(() => undefined)
  }, [])

  const handleCopyContextThreadId = useCallback((thread: ThreadViewModel) => {
    void copyToClipboard(thread.id).catch(() => undefined)
  }, [])

  const handleArchiveFromContextMenu = useCallback((thread: ThreadViewModel) => {
    if (!onArchiveThread) return
    void onArchiveThread(thread.id)
  }, [onArchiveThread])

  const suppressFolderAction = useCallback((event: SuppressInteractionEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleStartThreadInFolder = useCallback((cwd: string) => {
    onStartThreadInCwd(cwd)
  }, [onStartThreadInCwd])

  const handleCreateProject = useCallback(() => {
    if (!onCreateProject) return
    void onCreateProject()
  }, [onCreateProject])

  const markFolderRemoved = useCallback((cwd: string) => {
    if (hiddenGroupCwdSet.has(cwd)) return
    const isCurrentGroup = selectedCwd === cwd || (!selectedCwd && activeThreadCwd === cwd)
    const fallback = groupedThreads.find((group) => group.cwd !== cwd && !hiddenGroupCwdSet.has(group.cwd))?.cwd
    if (isCurrentGroup && !fallback) return

    if (isCurrentGroup && fallback) {
      onSelectCwd(fallback)
    }
    onHideThreadGroup(cwd)
  }, [activeThreadCwd, groupedThreads, hiddenGroupCwdSet, onHideThreadGroup, onSelectCwd, selectedCwd])

  const handleFolderOpenChange = useCallback((cwd: string, open: boolean) => {
    setOpenByCwd((previous) => {
      if (previous[cwd] === open) return previous
      return { ...previous, [cwd]: open }
    })
  }, [])

  const submitRename = useCallback(async () => {
    if (!renameThreadTarget || !onRenameThread) return
    const nextLabel = renameValue.trim()
    if (!nextLabel) return
    setIsRenaming(true)
    try {
      await onRenameThread(renameThreadTarget.id, nextLabel)
      setRenameThreadTarget((previous) => (previous === null ? previous : null))
      setRenameValue((previous) => (previous === '' ? previous : ''))
    } catch {
      // Keep dialog open so users can retry after transient RPC failures.
    } finally {
      setIsRenaming(false)
    }
  }, [onRenameThread, renameThreadTarget, renameValue])

  const quickEntryBaseRowClass =
    'h-8 gap-3 rounded-md px-3 ui-text-base font-normal ui-sidebar-text-secondary transition-colors hover:bg-[var(--surface-selected)] hover:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]'
  const quickEntryRowClass = `w-full justify-start ${quickEntryBaseRowClass}`
  const quickEntryStaticRowClass = `flex items-center ${quickEntryBaseRowClass} cursor-default`
  const quickEntryIconClass = 'inline-flex h-4 w-4 shrink-0 items-center justify-center opacity-70'

  if (isSettingsOpen && onCloseSettings) {
    return (
      <aside className="app-sidebar-rail flex flex-col h-full flex-none w-full overflow-hidden">
        <div
          className={cn(
            'app-sidebar-topbar h-[var(--desktop-chrome-height)] flex-none px-4 flex items-center',
            isDesktopClient && 'app-shell-drag-region',
          )}
        >
          {isDesktopClient && (
            <div
              className="h-[var(--desktop-traffic-light-safe-height)] w-[var(--desktop-traffic-light-safe-width)] app-shell-no-drag"
              aria-hidden
            />
          )}
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden left-rail-scroll-body">
          <div className="flex flex-col min-h-full">
            <div className="px-2 space-y-px flex-none">
              <Button
                variant="ghost"
                className="w-full justify-start h-8 gap-2 rounded-md px-3 ui-text-base font-normal ui-sidebar-text-secondary transition-colors hover:bg-[var(--surface-selected)] hover:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))] text-muted-foreground mb-4"
                onClick={onCloseSettings}
              >
                <ArrowLeft className="h-4 w-4" />
                返回应用
              </Button>

              <Button variant="ghost" className="w-full justify-start h-8 gap-2 rounded-md px-3 ui-text-base font-medium bg-[var(--surface-selected)] shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))] text-foreground">
                <Settings className="h-4 w-4 opacity-70" />
                常规
              </Button>
              <Button variant="ghost" className="w-full justify-start h-8 gap-2 rounded-md px-3 ui-text-base font-normal ui-sidebar-text-secondary hover:bg-[var(--surface-selected)] hover:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]">
                <Monitor className="h-4 w-4 opacity-70" />
                Appearance
              </Button>
              <Button variant="ghost" className="w-full justify-start h-8 gap-2 rounded-md px-3 ui-text-base font-normal ui-sidebar-text-secondary hover:bg-[var(--surface-selected)] hover:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]">
                <Settings2 className="h-4 w-4 opacity-70" />
                配置
              </Button>
              <Button variant="ghost" className="w-full justify-start h-8 gap-2 rounded-md px-3 ui-text-base font-normal ui-sidebar-text-secondary hover:bg-[var(--surface-selected)] hover:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]">
                <Palette className="h-4 w-4 opacity-70" />
                个性化
              </Button>
              <Button variant="ghost" className="w-full justify-start h-8 gap-2 rounded-md px-3 ui-text-base font-normal ui-sidebar-text-secondary hover:bg-[var(--surface-selected)] hover:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]">
                <Server className="h-4 w-4 opacity-70" />
                MCP 服务器
              </Button>
              <Button variant="ghost" className="w-full justify-start h-8 gap-2 rounded-md px-3 ui-text-base font-normal ui-sidebar-text-secondary hover:bg-[var(--surface-selected)] hover:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]">
                <GitBranch className="h-4 w-4 opacity-70" />
                Git
              </Button>
              <Button variant="ghost" className="w-full justify-start h-8 gap-2 rounded-md px-3 ui-text-base font-normal ui-sidebar-text-secondary hover:bg-[var(--surface-selected)] hover:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]">
                <TerminalSquare className="h-4 w-4 opacity-70" />
                环境
              </Button>
              <Button variant="ghost" className="w-full justify-start h-8 gap-2 rounded-md px-3 ui-text-base font-normal ui-sidebar-text-secondary hover:bg-[var(--surface-selected)] hover:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]">
                <FolderTree className="h-4 w-4 opacity-70" />
                工作树
              </Button>
              <Button variant="ghost" className="w-full justify-start h-8 gap-2 rounded-md px-3 ui-text-base font-normal ui-sidebar-text-secondary hover:bg-[var(--surface-selected)] hover:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]">
                <ArchiveRestore className="h-4 w-4 opacity-70" />
                已归档线程
              </Button>
            </div>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="app-sidebar-rail flex flex-col h-full flex-none w-full overflow-hidden">
      <div
        className={cn(
          'app-sidebar-topbar h-[var(--desktop-chrome-height)] flex-none px-4 flex items-center',
          isDesktopClient && 'app-shell-drag-region',
        )}
      >
        {isDesktopClient ? (
          <div
            className="h-[var(--desktop-traffic-light-safe-height)] w-[var(--desktop-traffic-light-safe-width)] app-shell-no-drag"
            aria-hidden
          />
        ) : (
          <div className="ui-text-meta ui-sidebar-text-muted font-medium">Formax Web</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden left-rail-scroll-body">
        <div className="flex flex-col min-h-full">
          <div className="px-2 space-y-px flex-none">
            {connectionStatus ? <div className="px-3 pb-2 ui-text-meta ui-sidebar-text-muted">{connectionStatus}</div> : null}
            <Button
              variant="ghost"
              className={quickEntryRowClass}
              onClick={onStartThread}
              disabled={isBusy}
            >
              <span className={quickEntryIconClass} aria-hidden>
                <SquarePen className="h-4 w-4" />
              </span>
              New thread
            </Button>
            <div className="space-y-px">
              <div className={quickEntryStaticRowClass}>
                <span className={quickEntryIconClass} aria-hidden>
                  <Clock3 className="h-4 w-4" />
                </span>
                Automation
              </div>
              <div className={quickEntryStaticRowClass}>
                <span className={quickEntryIconClass} aria-hidden>
                  <Sparkles className="h-4 w-4" />
                </span>
                Skills
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col mt-2 pb-12">
            <div className="px-5 ui-text-base font-medium ui-sidebar-text-muted tracking-wide flex items-center justify-between gap-2 flex-none">
              <span>Threads</span>
              {canCreateProject ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  aria-label="Add project"
                  title="Add project"
                  disabled={isBusy}
                  onClick={handleCreateProject}
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>

            <div className="space-y-px px-2">
              {visibleGroupedThreads.length === 0 ? <div className="px-4 py-4 ui-text-meta ui-sidebar-text-muted italic">No recent threads</div> : null}
              {visibleGroupedThreads.map((group) => {
                const isSelectedGroup = selectedCwd === group.cwd || (!selectedCwd && activeThreadCwd === group.cwd)
                const isExpanded = openByCwd[group.cwd] ?? true
                const canRemoveGroup = !isSelectedGroup || visibleGroupedThreads.length > 1
                return (
                  <Collapsible
                    key={group.cwd}
                    open={isExpanded}
                    onOpenChange={(open) => handleFolderOpenChange(group.cwd, open)}
                    className="space-y-px"
                  >
                    <CollapsibleTrigger asChild>
                      <MemoFolderHeaderRow
                        cwd={group.cwd}
                        folderName={group.folderName}
                        isExpanded={isExpanded}
                        canRemoveGroup={canRemoveGroup}
                        isBusy={isBusy}
                        onSelectCwd={onSelectCwd}
                        onMarkFolderRemoved={markFolderRemoved}
                        onStartThreadInFolder={handleStartThreadInFolder}
                        suppressFolderAction={suppressFolderAction}
                      />
                    </CollapsibleTrigger>

                    <CollapsibleContent className="space-y-px">
                      {group.threads.map((thread) => {
                        return (
                          <MemoThreadRow
                            key={thread.id}
                            thread={thread}
                            isActive={activeThreadId === thread.id}
                            isBusy={isBusy}
                            nowMsSnapshot={nowMsSnapshot}
                            canRenameThread={canRenameThread}
                            canArchiveThread={canArchiveThread}
                            onSelectThread={onSelectThread}
                            onRenameFromContextMenu={handleRenameFromContextMenu}
                            onArchiveFromContextMenu={handleArchiveFromContextMenu}
                            onCopyContextCwd={handleCopyContextCwd}
                            onCopyContextThreadId={handleCopyContextThreadId}
                          />
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

      <div
        className={cn(
          'app-sidebar-bottombar h-[var(--desktop-chrome-height)] flex-none px-2 py-[var(--desktop-chrome-row-padding-y)]',
          isDesktopClient && 'app-shell-drag-region',
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className={cn(
                quickEntryRowClass,
                'app-shell-no-drag',
              )}
            >
              <span className={quickEntryIconClass} aria-hidden>
                <Settings className="h-4 w-4" />
              </span>
              设置
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48 app-shell-no-drag" side="top" align="start" sideOffset={8}>
            {onOpenSettings ? (
              <DropdownMenuItem onSelect={onOpenSettings}>
                <Settings className="mr-2 h-4 w-4" />
                设置
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem>
              <Globe className="mr-2 h-4 w-4" />
              语言
            </DropdownMenuItem>
            {isDesktopClient && onToggleSidebarTransparency ? (
              <DropdownMenuItem onSelect={() => onToggleSidebarTransparency(!isSidebarTransparent)}>
                {isSidebarTransparent ? '关闭侧边栏透明' : '开启侧边栏透明'}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
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
