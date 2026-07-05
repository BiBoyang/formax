import type { ReactNode } from 'react'
import { Plus, SquarePlus } from 'lucide-react'
import { Button } from '../../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import { cn } from '../../lib/utils'
import { useI18n } from '../i18n/I18nProvider'

export type RightRailWorkspaceHeaderProps = {
  isDesktopClient: boolean
  controls: ReactNode
}

export function RightRailWorkspaceHeader(props: RightRailWorkspaceHeaderProps) {
  const { t } = useI18n()

  return (
    <header
      data-testid="right-rail-workspace-header"
      className={cn(
        'h-[var(--desktop-chrome-height)] flex-none app-shell-right-header',
        props.isDesktopClient && 'app-shell-drag-region',
      )}
    >
      <div className="flex h-full min-w-0 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="inline-flex h-[26px] min-w-0 items-center gap-2 rounded-[10px] bg-muted/55 px-2.5 text-foreground">
            <SquarePlus className="h-4 w-4 shrink-0" />
            <span className="truncate ui-text-base font-semibold">{t('worktreeDiff.reviewTab')}</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'h-[26px] w-[26px] rounded-[8px] bg-transparent text-muted-foreground hover:bg-muted/55 hover:text-foreground',
                  props.isDesktopClient && 'app-shell-no-drag',
                )}
                aria-label={t('worktreeDiff.addRailTab')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6} className="ui-menu-content w-[var(--composer-menu-width)] p-1">
              <DropdownMenuItem className="ui-composer-menu-item ui-text-base" disabled>{t('worktreeDiff.railTabTerminal')}</DropdownMenuItem>
              <DropdownMenuItem className="ui-composer-menu-item ui-text-base" disabled>{t('worktreeDiff.railTabBrowser')}</DropdownMenuItem>
              <DropdownMenuItem className="ui-composer-menu-item ui-text-base" disabled>{t('worktreeDiff.railTabFiles')}</DropdownMenuItem>
              <DropdownMenuItem className="ui-composer-menu-item ui-text-base" disabled>{t('worktreeDiff.railTabSideChat')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {props.controls}
      </div>
    </header>
  )
}
