import React, { useCallback, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'

export type EditApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_all' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }

export function EditApprovalPrompt({
  title,
  onDecision,
}: {
  title: string
  onDecision: (decision: EditApprovalDecision) => void
}): React.ReactNode {
  const theme = getTheme()
  const [cursor, setCursor] = useState(0) // 0..2
  const [typing, setTyping] = useState(false)
  const [typingValue, setTypingValue] = useState('')
  const submittedRef = useRef(false)

  const submit = useCallback(
    (d: EditApprovalDecision) => {
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

      if (typing) {
        if (key.return) {
          submit({ kind: 'feedback', feedback: typingValue.trim() })
          return
        }

        if (key.backspace || key.delete) {
          setTypingValue((v) => v.slice(0, -1))
          return
        }

        if (input && !key.ctrl && !key.meta) {
          setTypingValue((v) => v + input)
        }

        return
      }

      if (key.upArrow) setCursor((c) => Math.max(0, c - 1))
      if (key.downArrow) setCursor((c) => Math.min(2, c + 1))

      if (input === '1') setCursor(0)
      if (input === '2') setCursor(1)
      if (input === '3') setCursor(2)

      if (key.return) {
        if (cursor === 0) submit({ kind: 'approve' })
        else if (cursor === 1) submit({ kind: 'approve_all' })
        else setTyping(true)
      }
    },
    { isActive: true },
  )

  const feedbackLine = typing
    ? `${typingValue}▏`
    : typingValue.trim()
      ? typingValue.trim()
      : 'Type here to tell Claude what to do differently'

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text bold>{title}</Text>
      </Box>

      <Box flexDirection="column">
        <MenuRow cursor={cursor === 0} label="1. Yes" />
        <MenuRow cursor={cursor === 1} label="2. Yes, allow all edits during this session (shift+tab)" />
        <MenuRow cursor={cursor === 2} label={`3. ${feedbackLine}`} dim={typing} />
      </Box>

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Esc to cancel</Text>
      </Box>
    </Box>
  )
}

function MenuRow({ cursor, label, dim }: { cursor: boolean; label: string; dim?: boolean }): React.ReactNode {
  const theme = getTheme()
  const color = cursor ? theme.text : theme.secondaryText
  return (
    <Box>
      <Text>{cursor ? '❯ ' : '  '}</Text>
      <Text color={dim ? theme.secondaryText : color}>{label}</Text>
    </Box>
  )
}

