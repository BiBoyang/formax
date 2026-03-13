import React from 'react'
import { Box } from 'ink'

type Props = React.ComponentProps<typeof Box> & {
  children: React.ReactNode
}

export function OverlayFrame({ children, ...props }: Props): React.ReactNode {
  return (
    <Box flexDirection="column" width="100%" {...props}>
      {children}
    </Box>
  )
}

