import React, { useCallback, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'

export type BashApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember' }
  | { kind: 'cancel' }

export function BashApprovalPrompt({
  title,
  command,
  cwd,
  onDecision,
}: {
  title: string
  command: string
  cwd: string
  onDecision: (decision: BashApprovalDecision) => void
}): React.ReactNode {
  const theme = getTheme()
  const [cursor, setCursor] = useState(0) // 0..2
  const submittedRef = useRef(false)

  const submit = useCallback(
    (d: BashApprovalDecision) => {
      if (submittedRef.current) return
      submittedRef.current = true
      onDecision(d)
    },
    [onDecision],
  )

  useInput(
    (input, key) => {
      if (submittedRef.current) return

      if (key.escape) {
        submit({ kind: 'cancel' })
        return
      }

      if (key.upArrow) setCursor((c) => Math.max(0, c - 1))
      if (key.downArrow) setCursor((c) => Math.min(2, c + 1))

      if (input === '1') setCursor(0)
      if (input === '2') setCursor(1)
      if (input === '3') setCursor(2)

      if (key.return) {
        if (cursor === 0) submit({ kind: 'approve' })
        else if (cursor === 1) submit({ kind: 'approve_remember' })
        else submit({ kind: 'cancel' })
      }
    },
    { isActive: true },
  )

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text bold>{title}</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text color={theme.secondaryText}>Command:</Text>
        <Text>{command || '(empty)'}</Text>
        <Text color={theme.secondaryText}>Cwd:</Text>
        <Text color={theme.secondaryText}>{cwd}</Text>
      </Box>

      <Box flexDirection="column">
        <MenuRow cursor={cursor === 0} label="1. Yes, run" />
        <MenuRow cursor={cursor === 1} label="2. Yes, remember for this session" />
        <MenuRow cursor={cursor === 2} label="3. Cancel" />
      </Box>

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Enter to select · Esc to cancel</Text>
      </Box>
    </Box>
  )
}

function MenuRow({ cursor, label }: { cursor: boolean; label: string }): React.ReactNode {
  const theme = getTheme()
  const color = cursor ? theme.text : theme.secondaryText
  return (
    <Box>
      <Text>{cursor ? '❯ ' : '  '}</Text>
      <Text color={color}>{label}</Text>
    </Box>
  )
}

