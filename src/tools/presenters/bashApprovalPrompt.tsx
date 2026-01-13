import React, { useCallback, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'

export type BashApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember'; scope: 'session' | 'project' | 'global' }
  | { kind: 'feedback'; feedback: string }
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
  const [rememberScope, setRememberScope] = useState<'session' | 'project' | 'global'>('session')
  const [typing, setTyping] = useState(false)
  const [typingValue, setTypingValue] = useState('')
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

      if (key.shift && key.tab) {
        setRememberScope((s) => (s === 'session' ? 'project' : s === 'project' ? 'global' : 'session'))
        setCursor(1)
        return
      }

      if (key.escape) {
        submit({ kind: 'cancel' })
        return
      }

      if (typing) {
        if (key.upArrow) {
          setTyping(false)
          setCursor((c) => Math.max(0, c - 1))
          return
        }
        if (key.downArrow) {
          setTyping(false)
          setCursor((c) => Math.min(2, c + 1))
          return
        }

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
          return
        }

        return
      }

      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1))
        return
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(2, c + 1))
        return
      }

      if (key.return) {
        if (cursor === 0) submit({ kind: 'approve' })
        else if (cursor === 1) submit({ kind: 'approve_remember', scope: rememberScope })
        else setTyping(true)
        return
      }

      if (cursor === 2 && input && !key.ctrl && !key.meta) {
        setTyping(true)
        setTypingValue((v) => v + input)
        return
      }

      if (input === '1') {
        setCursor(0)
        return
      }
      if (input === '2') {
        setCursor(1)
        return
      }
      if (input === '3') {
        setCursor(2)
        return
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
        <MenuRow cursor={cursor === 0} label="1. Yes" />
        <MenuRow cursor={cursor === 1} label={`2. Yes, remember for ${rememberScope} (shift+tab to cycle)`} />
        <FeedbackRow cursor={cursor === 2} typing={typing} value={typingValue} />
      </Box>

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Esc to cancel</Text>
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

function FeedbackRow({
  cursor,
  typing,
  value,
}: {
  cursor: boolean
  typing: boolean
  value: string
}): React.ReactNode {
  const theme = getTheme()

  const hasValue = Boolean((value || '').trim())
  const showPlaceholder = !typing && !hasValue

  const color = cursor ? theme.text : theme.secondaryText

  return (
    <Box>
      <Text>{cursor ? '❯ ' : '  '}</Text>
      <Text color={color}>3. </Text>
      {showPlaceholder ? (
        <Text color={theme.secondaryText}>Type here to tell Claude what to do differently</Text>
      ) : (
        <Text color={color}>{typing ? `${value || ''}▏` : value || ''}</Text>
      )}
    </Box>
  )
}
