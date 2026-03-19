import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderPlus, Globe, Settings, Sparkles, SquarePen, ArrowLeft, Monitor, Settings2, Palette, Server, GitBranch, TerminalSquare, FolderTree, ArchiveRestore, Clock3 } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ThreadViewModel } from '../app/core/threadViewModel'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import {
  copyToClipboard,
  groupThreadsByCwd,
  MemoFolderHeaderRow,
  MemoThreadRow,
  RailActionIconButton,
  readOpenByCwdFromStorage,
  SidebarItem,
  type SuppressInteractionEvent,
  writeOpenByCwdToStorage,
} from './left-rail'

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
  onToggleSidebarTransparency?: () => void
  isSettingsOpen?: boolean
  onOpenSettings?: () => void
  onCloseSettings?: () => void
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

  const createProjectButton = (
    <RailActionIconButton
      aria-label="Add project"
      title={canCreateProject ? 'Add project' : 'Desktop only'}
      disabled={isBusy}
      className="text-muted-foreground hover:text-foreground hover:bg-muted/40"
      onClick={handleCreateProject}
    >
      <FolderPlus className="h-3.5 w-3.5" />
    </RailActionIconButton>
  )

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
              <SidebarItem
                tone="muted"
                className="mb-4"
                icon={<ArrowLeft className="h-4 w-4" />}
                label="返回应用"
                onActivate={onCloseSettings}
              />

              <SidebarItem
                tone="primary"
                selected
                selectable
                className="font-medium"
                icon={<Settings className="h-4 w-4" />}
                label="常规"
              />
              <SidebarItem icon={<Monitor className="h-4 w-4" />} label="Appearance" />
              <SidebarItem icon={<Settings2 className="h-4 w-4" />} label="配置" />
              <SidebarItem icon={<Palette className="h-4 w-4" />} label="个性化" />
              <SidebarItem icon={<Server className="h-4 w-4" />} label="MCP 服务器" />
              <SidebarItem icon={<GitBranch className="h-4 w-4" />} label="Git" />
              <SidebarItem icon={<TerminalSquare className="h-4 w-4" />} label="环境" />
              <SidebarItem icon={<FolderTree className="h-4 w-4" />} label="工作树" />
              <SidebarItem icon={<ArchiveRestore className="h-4 w-4" />} label="已归档线程" />
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
            <SidebarItem
              icon={<SquarePen className="h-4 w-4" />}
              label="New thread"
              onActivate={onStartThread}
              disabled={isBusy}
            />
            <div className="space-y-px">
              <SidebarItem kind="static" icon={<Clock3 className="h-4 w-4" />} label="Automation" />
              <SidebarItem kind="static" icon={<Sparkles className="h-4 w-4" />} label="Skills" />
            </div>
          </div>

          <div className="flex-1 flex flex-col mt-2 pb-12">
            <div className="px-5 ui-text-base font-medium ui-sidebar-text-muted tracking-wide flex items-center justify-between gap-2 flex-none">
              <span>Threads</span>
              {canCreateProject ? (
                createProjectButton
              ) : (
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>{createProjectButton}</TooltipTrigger>
                    <TooltipContent side="bottom" align="end">
                      仅桌面客户端可用
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
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
            <SidebarItem className="app-shell-no-drag" icon={<Settings className="h-4 w-4" />} label="设置" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48 app-shell-no-drag" side="top" align="start" sideOffset={8}>
            {onOpenSettings ? (
              <SidebarItem kind="menu" icon={<Settings className="h-4 w-4" />} label="设置" onActivate={onOpenSettings} />
            ) : null}
            <SidebarItem kind="menu" icon={<Globe className="h-4 w-4" />} label="语言" />
            {isDesktopClient && onToggleSidebarTransparency ? (
              <SidebarItem
                kind="menu"
                label={isSidebarTransparent ? '关闭侧边栏透明' : '开启侧边栏透明'}
                onActivate={onToggleSidebarTransparency}
              />
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
