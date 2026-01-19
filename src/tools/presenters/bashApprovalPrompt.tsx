import React, { useCallback, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'
import TextInput from '../../components/ui/TextInput.js'

export type BashApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember' }
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
  const [cursor, setCursor] = useState(0) // 0..3
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
          setCursor((c) => Math.min(3, c + 1))
          return
        }
        // Let `TextInput` handle editing + Enter submission.
        return
      }

      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1))
        return
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(3, c + 1))
        return
      }

      if (key.return) {
        if (cursor === 0) submit({ kind: 'approve' })
        else if (cursor === 1) submit({ kind: 'approve_remember' })
        else if (cursor === 2) setTyping(true)
        else submit({ kind: 'cancel' })
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
        setTyping(true)
        setTypingValue('')
        return
      }
      if (input === '4') {
        setCursor(3)
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
        <MenuRow cursor={cursor === 1} label="2. Yes, don't ask again for this command in this repo" />
        <FeedbackRow
          cursor={cursor === 2}
          typing={typing}
          value={typingValue}
          onChange={setTypingValue}
          onSubmit={() => submit({ kind: 'feedback', feedback: typingValue.trim() })}
        />
        <MenuRow cursor={cursor === 3} label="4. Cancel" dim />
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

function FeedbackRow({
  cursor,
  typing,
  value,
  onChange,
  onSubmit,
}: {
  cursor: boolean
  typing: boolean
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
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
        <>
          {typing ? (
            <TextInput
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              cursorStyle="bar"
              cursorChar="▏"
              focus={cursor}
            />
          ) : (
            <Text color={color}>{value || ''}</Text>
          )}
        </>
      )}
    </Box>
  )
}
