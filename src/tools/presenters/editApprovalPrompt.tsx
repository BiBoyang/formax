import React, { useCallback, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'
import { useReplUi } from '../../features/repl/replUiContext'

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
  const replUi = useReplUi()
  const [cursor, setCursor] = useState(0) // 0..3
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

      if (key.shift && key.tab) {
        submit({ kind: 'approve_all' })
        return
      }

      if (key.escape) {
        // Escape should cancel the tool use and also interrupt the current turn so
        // the model doesn't continue emitting output after a rejected edit/write.
        submit({ kind: 'cancel' })
        replUi?.abort()
        return
      }

      if (typing) {
        // Claude Code preserves the draft even if you navigate away while typing.
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
        else if (cursor === 1) submit({ kind: 'approve_all' })
        else if (cursor === 2) setTyping(true)
        else {
          submit({ kind: 'cancel' })
          replUi?.abort()
        }
        return
      }

      // When the "custom message" row is selected, any character (including digits)
      // should start editing instead of triggering numeric shortcuts.
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

      <Box flexDirection="column">
        <MenuRow cursor={cursor === 0} label="1. Yes" />
        <MenuRow cursor={cursor === 1} label="2. Yes, allow all edits during this session (shift+tab)" />
        <FeedbackRow cursor={cursor === 2} typing={typing} value={typingValue} />
        <MenuRow cursor={cursor === 3} label="4. Cancel" />
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
}: {
  cursor: boolean
  typing: boolean
  value: string
}): React.ReactNode {
  const theme = getTheme()

  const hasValue = Boolean((value || '').trim())
  const showPlaceholder = !typing && !hasValue

  const color = cursor ? theme.text : theme.secondaryText
  const placeholderColor = cursor ? theme.secondaryText : theme.secondaryText

  return (
    <Box>
      <Text>{cursor ? '❯ ' : '  '}</Text>
      <Text color={color}>3. </Text>
      {showPlaceholder ? (
        <Text color={placeholderColor}>Type here to tell Claude what to do differently</Text>
      ) : (
        <>
          <Text color={color}>{value || ''}</Text>
          {typing ? <Text color={theme.secondaryText}>▏</Text> : null}
        </>
      )}
    </Box>
  )
}
