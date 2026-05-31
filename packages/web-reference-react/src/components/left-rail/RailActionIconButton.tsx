import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

export type RailActionIconButtonProps = Omit<ComponentPropsWithoutRef<typeof Button>, 'size' | 'variant'>

export function RailActionIconButton(props: RailActionIconButtonProps) {
  const { className, type = 'button', ...rest } = props

  return (
    <Button
      type={type}
      size="icon"
      variant="ghost"
      className={cn(
        'ui-sidebar-action-icon-button focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:border-transparent',
        className,
      )}
      {...rest}
    />
  )
}
