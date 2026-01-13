import React, { useCallback, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'

export type EditApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember'; scope: 'session' | 'project' | 'global' }
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
  const [rememberScope, setRememberScope] = useState<'session' | 'project' | 'global'>('session')
  const [typing, setTyping] = useState(false)
  const [typingValue, setTypingValue] = useState('')
  const submittedRef = useRef(false)
  const cursorRef = useRef(0)
  const typingRef = useRef(false)
  const typingValueRef = useRef('')

  const setCursorImmediate = useCallback((next: number | ((current: number) => number)) => {
    const v = typeof next === 'function' ? next(cursorRef.current) : next
    cursorRef.current = v
    setCursor(v)
  }, [])

  const setTypingImmediate = useCallback((next: boolean) => {
    typingRef.current = next
    setTyping(next)
  }, [])

  const setTypingValueImmediate = useCallback((next: string | ((current: string) => string)) => {
    const v = typeof next === 'function' ? next(typingValueRef.current) : next
    typingValueRef.current = v
    setTypingValue(v)
  }, [])

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
      const currentCursor = cursorRef.current
      const isTyping = typingRef.current

      if (key.shift && key.tab) {
        setRememberScope((s) => (s === 'session' ? 'project' : s === 'project' ? 'global' : 'session'))
        setCursorImmediate(1)
        return
      }

      if (key.escape) {
        submit({ kind: 'cancel' })
        return
      }

      if (isTyping) {
        // Claude Code preserves the draft even if you navigate away while typing.
        if (key.upArrow) {
          setTypingImmediate(false)
          setCursorImmediate((c) => Math.max(0, c - 1))
          return
        }
        if (key.downArrow) {
          setTypingImmediate(false)
          setCursorImmediate((c) => Math.min(2, c + 1))
          return
        }

        if (key.return) {
          submit({ kind: 'feedback', feedback: typingValueRef.current.trim() })
          return
        }

        if (key.backspace || key.delete) {
          setTypingValueImmediate((v) => v.slice(0, -1))
          return
        }

        if (input && !key.ctrl && !key.meta) {
          setTypingValueImmediate((v) => v + input)
        }

        return
      }

      if (key.upArrow) {
        setCursorImmediate((c) => Math.max(0, c - 1))
        return
      }
      if (key.downArrow) {
        setCursorImmediate((c) => Math.min(2, c + 1))
        return
      }

      if (key.return) {
        if (currentCursor === 0) submit({ kind: 'approve' })
        else if (currentCursor === 1) submit({ kind: 'approve_remember', scope: rememberScope })
        else setTypingImmediate(true)
        return
      }

      // When the "custom message" row is selected, any character (including digits)
      // should start editing instead of triggering numeric shortcuts.
      if (currentCursor === 2 && input && !key.ctrl && !key.meta) {
        setTypingImmediate(true)
        setTypingValueImmediate((v) => v + input)
        return
      }

      if (input === '1') {
        setCursorImmediate(0)
        return
      }
      if (input === '2') {
        setCursorImmediate(1)
        return
      }
      if (input === '3') {
        setCursorImmediate(2)
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
        <MenuRow cursor={cursor === 1} label={`2. Yes, remember for ${rememberScope} (shift+tab to cycle)`} />
        <FeedbackRow cursor={cursor === 2} typing={typing} value={typingValue} />
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
  const placeholderColor = theme.secondaryText

  return (
    <Box>
      <Text>{cursor ? '❯ ' : '  '}</Text>
      <Text color={color}>3. </Text>
      {showPlaceholder ? (
        <Text color={placeholderColor}>Type here to tell Claude what to do differently</Text>
      ) : (
        <Text color={color}>{typing ? `${value || ''}▏` : value || ''}</Text>
      )}
    </Box>
  )
}
