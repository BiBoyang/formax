import React from 'react'
import { Text } from 'ink'
import type { ReplMode } from '../../features/repl/mode'
import { getTheme } from '../../tui/theme'
import { ModeIndicator } from './ModeIndicator'

type Props = {
  mode: ReplMode
  ctrlCArmed: boolean
  isBashInput: boolean
}

// Bottom-of-input hint area. This is *not* the same as the REPL "mode":
// some hints (Ctrl-C-to-exit, "! for bash mode") are transient overlays.
export function ReplFooterHint({ mode, ctrlCArmed, isBashInput }: Props): React.ReactNode {
  const theme = getTheme()

  if (ctrlCArmed) {
    return <Text dimColor>Press Ctrl-C again to exit</Text>
  }

  if (isBashInput) {
    return <Text color={theme.bashBorder}>! for bash mode</Text>
  }

  if (mode === 'normal') {
    return <Text dimColor>? for shortcuts</Text>
  }

  return <ModeIndicator mode={mode} />
}

