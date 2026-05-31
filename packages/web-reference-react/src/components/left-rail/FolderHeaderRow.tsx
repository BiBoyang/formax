import { forwardRef, memo, useState, type ComponentPropsWithoutRef } from 'react'
import { Folder, FolderOpen, MoreHorizontal, SquarePen } from 'lucide-react'

import { useI18n } from '../../app/i18n/I18nProvider'
import { cn } from '../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
        className="group/folder ui-sidebar-folder-row transition-colors"
        leading={(
          <span className="ui-sidebar-folder-icon-slot">
            {isExpanded ? (
              <FolderOpen className="transition-opacity" />
            ) : (
              <Folder className="transition-opacity group-hover/folder:opacity-0" />
            )}
            {!isExpanded ? (
              <FolderOpen className="opacity-0 transition-opacity group-hover/folder:opacity-100" />
            ) : null}
          </span>
        )}
        label={folderName}
        title={cwd}
        onActivate={() => onSelectCwd(cwd)}
        trailing={(
          <div className="pointer-events-none absolute right-[var(--sidebar-action-icon-slot-right)] top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/folder:opacity-100 group-focus-within/folder:opacity-100">
            <DropdownMenu open={isActionsMenuOpen} onOpenChange={setIsActionsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <RailActionIconButton
                  type="button"
                  aria-label={t('leftRail.folderActions', { folder: folderName })}
                  className="pointer-events-auto hover:bg-transparent dark:hover:bg-transparent"
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
                  <MoreHorizontal />
                </RailActionIconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-w-[170px]" side="left" align="start" sideOffset={6}>
                <DropdownMenuItem
                  className="ui-sidebar-item ui-sidebar-item-menu ui-sidebar-menu-item ui-text-base ui-sidebar-text-secondary"
                  disabled={!onOpenFolderInTarget}
                  onSelect={(event) => {
                    event.preventDefault()
                    onOpenFolderInTarget?.(cwd)
                    setIsActionsMenuOpen(false)
                  }}
                >
                  {resolvedOpenFolderActionLabel}
                </DropdownMenuItem>
                <DropdownMenuItem className="ui-sidebar-item ui-sidebar-item-menu ui-sidebar-menu-item ui-text-base ui-sidebar-text-secondary" disabled>
                  {t('leftRail.createPermanentWorktree')}
                </DropdownMenuItem>
                <DropdownMenuItem className="ui-sidebar-item ui-sidebar-item-menu ui-sidebar-menu-item ui-text-base ui-sidebar-text-secondary" disabled>
                  {t('leftRail.editName')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="ui-sidebar-item ui-sidebar-item-menu ui-sidebar-menu-item ui-text-base ui-sidebar-text-secondary"
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
              className="pointer-events-auto hover:bg-transparent dark:hover:bg-transparent"
              onClick={(event) => {
                suppressFolderAction(event)
                onStartThreadInFolder(cwd)
              }}
            >
              <SquarePen />
            </RailActionIconButton>
          </div>
        )}
      />
    </div>
  )
})

export const MemoFolderHeaderRow = memo(FolderHeaderRow)
