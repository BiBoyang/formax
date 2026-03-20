import { memo } from 'react'

import { useI18n } from '../../app/i18n/I18nProvider'
import type { ThreadViewModel } from '../../app/core/threadViewModel'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { SidebarItem } from './SidebarItem'
import { relativeTime } from './utils'

export type ThreadRowProps = {
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

export const MemoThreadRow = memo(function ThreadRow(props: ThreadRowProps) {
  const { t } = useI18n()
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
        <SidebarItem
          tone="inherit"
          hoverable={false}
          selected={isActive}
          className="group/thread ui-sidebar-list-row pl-6 pr-2 gap-2 transition-none"
          label={thread.title}
          trailing={relativeTime(thread.updatedAt, nowMsSnapshot)}
          trailingClassName="ui-text-meta font-mono tabular-nums ui-sidebar-list-row-time"
          onActivate={() => onSelectThread(thread.id)}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!canRenameThread}
          onSelect={() => onRenameFromContextMenu(thread)}
        >
          {t('leftRail.renameThread')}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canArchiveThread || isBusy}
          onSelect={() => onArchiveFromContextMenu(thread)}
        >
          {t('leftRail.archiveThread')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => onCopyContextCwd(thread)}
        >
          {t('leftRail.copyWorkingDirectory')}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => onCopyContextThreadId(thread)}
        >
          {t('leftRail.copySessionId')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
