import { PanelLeft } from 'lucide-react'
import { cn } from '../../lib/utils'

export type AppShellPaneToggleIconProps = {
  side: 'left' | 'right'
  isOpen: boolean
  className?: string
}

export function AppShellPaneToggleIcon(props: AppShellPaneToggleIconProps) {
  const shouldMirror = props.side === 'left' ? !props.isOpen : props.isOpen

  return (
    <PanelLeft
      className={cn(
        'h-4 w-4 app-shell-header-icon-motion',
        shouldMirror && 'rotate-180',
        props.className,
      )}
    />
  )
}
