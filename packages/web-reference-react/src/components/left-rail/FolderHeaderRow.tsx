import { forwardRef, memo, useState, type ComponentPropsWithoutRef } from 'react'
import { ChevronDown, Folder, FolderOpen, MoreHorizontal, SquarePen } from 'lucide-react'

import { useI18n } from '../../app/i18n/I18nProvider'
import { cn } from '../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { RailActionIconButton } from './RailActionIconButton'
import { SidebarItem } from './SidebarItem'

export type SuppressInteractionEvent = {
  preventDefault: () => void
  stopPropagation: () => void
}

export type FolderHeaderRowProps = ComponentPropsWithoutRef<'div'> & {
  cwd: string
  folderName: string
  isExpanded: boolean
  canRemoveGroup: boolean
  isBusy: boolean
  onSelectCwd: (cwd: string) => void
  onMarkFolderRemoved: (cwd: string) => void
  onStartThreadInFolder: (cwd: string) => void
  onOpenFolderInTarget?: (cwd: string) => void
  openFolderActionLabel?: string
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
    onOpenFolderInTarget,
    openFolderActionLabel,
    suppressFolderAction,
    className,
    ...rest
  } = props
  const { t } = useI18n()
  const resolvedOpenFolderActionLabel = openFolderActionLabel ?? t('leftRail.openInTarget', { target: 'Finder' })
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false)

  return (
    <div
      ref={ref}
      {...rest}
      className={cn(className)}
    >
      <SidebarItem
        kind="row"
        tone="inherit"
        hoverable={false}
        className="group/folder ui-sidebar-folder-row h-8 min-w-0 px-3 gap-2 transition-colors"
        leading={(
          <span className="relative h-3.5 w-3.5 shrink-0">
            <ChevronDown className="absolute inset-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover/folder:opacity-70" />
            {isExpanded ? (
              <FolderOpen className="absolute inset-0 h-3.5 w-3.5 opacity-60 transition-opacity group-hover/folder:opacity-0" />
            ) : (
              <Folder className="absolute inset-0 h-3.5 w-3.5 opacity-60 transition-opacity group-hover/folder:opacity-0" />
            )}
          </span>
        )}
        label={folderName}
        title={cwd}
        onActivate={() => onSelectCwd(cwd)}
        trailing={(
          <div className="pointer-events-none mr-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/folder:opacity-100 group-focus-within/folder:opacity-100">
            <DropdownMenu open={isActionsMenuOpen} onOpenChange={setIsActionsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <RailActionIconButton
                  type="button"
                  aria-label={t('leftRail.folderActions', { folder: folderName })}
                  className="pointer-events-auto text-muted-foreground/90 hover:bg-transparent hover:text-muted-foreground/90 dark:hover:bg-transparent"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setIsActionsMenuOpen((previous) => !previous)
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </RailActionIconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" side="right" align="start" sideOffset={6}>
                <DropdownMenuItem
                  disabled={!onOpenFolderInTarget}
                  onSelect={(event) => {
                    event.preventDefault()
                    onOpenFolderInTarget?.(cwd)
                    setIsActionsMenuOpen(false)
                  }}
                >
                  {resolvedOpenFolderActionLabel}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>{t('leftRail.createPermanentWorktree')}</DropdownMenuItem>
                <DropdownMenuItem disabled>{t('leftRail.editName')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!canRemoveGroup}
                  onSelect={(event) => {
                    event.preventDefault()
                    onMarkFolderRemoved(cwd)
                    setIsActionsMenuOpen(false)
                  }}
                >
                  {t('leftRail.removeSessionFolder')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <RailActionIconButton
              type="button"
              aria-label={t('leftRail.startNewThreadInFolder', { folder: folderName })}
              title={t('leftRail.startNewThreadInFolder', { folder: folderName })}
              disabled={isBusy}
              className="pointer-events-auto text-muted-foreground/90 hover:bg-transparent hover:text-muted-foreground/90 dark:hover:bg-transparent"
              onClick={(event) => {
                suppressFolderAction(event)
                onStartThreadInFolder(cwd)
              }}
            >
              <SquarePen className="h-3.5 w-3.5" />
            </RailActionIconButton>
          </div>
        )}
      />
    </div>
  )
})

export const MemoFolderHeaderRow = memo(FolderHeaderRow)
