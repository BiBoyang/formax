import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../utils/theme'
import type { ReplMode } from '../../features/repl/mode'

type Props = {
  mode: ReplMode
}

export function ModeIndicator({ mode }: Props): React.ReactNode {
  const theme = getTheme()

  const modeConfig = {
    normal: {
      icon: '⏺',
      label: 'NORMAL',
      color: 'gray',
    },
    acceptEdits: {
      icon: '✓',
      label: 'ACCEPT EDITS',
      color: theme.success,
    },
    plan: {
      icon: '⚙',
      label: 'PLAN MODE',
      color: 'blue',
    },
  } as const

  const config = modeConfig[mode]

  return (
    <Text>
      <Text bold color={config.color}>
        {config.icon} {config.label}
      </Text>
      <Text dimColor> (shift+tab to cycle)</Text>
    </Text>
  )
}
