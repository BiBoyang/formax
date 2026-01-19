import React, { useCallback, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'
import TextInput from './TextInput.js'

export type ConfirmMenuOption =
  | { kind: 'choice'; key: string; label: string; dim?: boolean }
  | { kind: 'feedback'; key: string; label: string; placeholder: string }

export type ConfirmMenuDecision =
  | { kind: 'choice'; key: string }
  | { kind: 'feedback'; key: string; feedback: string }
  | { kind: 'cancel' }

export function ConfirmMenu({
  options,
  initialCursor = 0,
  onDecision,
  onShiftTab,
  shiftTabCursor = 1,
  footer,
}: {
  options: ConfirmMenuOption[]
  initialCursor?: number
  onDecision: (decision: ConfirmMenuDecision) => void
  onShiftTab?: () => void
  shiftTabCursor?: number
  footer?: React.ReactNode
}): React.ReactNode {
  const theme = getTheme()
  const [cursor, setCursor] = useState(initialCursor)
  const [typing, setTyping] = useState(false)
  const [typingValue, setTypingValue] = useState('')
  const submittedRef = useRef(false)
  const cursorRef = useRef(initialCursor)
  const typingRef = useRef(false)
  const typingValueRef = useRef('')

  const feedbackIndex = options.findIndex((o) => o.kind === 'feedback')

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
    (decision: ConfirmMenuDecision) => {
      if (submittedRef.current) return
      submittedRef.current = true
      onDecision(decision)
    },
    [onDecision],
  )

  useInput(
    (input, key) => {
      if (submittedRef.current) return
      const currentCursor = cursorRef.current
      const isTyping = typingRef.current

      if (key.shift && key.tab && onShiftTab) {
        if (isTyping) setTypingImmediate(false)
        onShiftTab()
        setCursorImmediate(clamp(shiftTabCursor, 0, options.length - 1))
        return
      }

      if (key.escape) {
        submit({ kind: 'cancel' })
        return
      }

      if (isTyping) {
        // Preserve draft while navigating.
        if (key.upArrow) {
          setTypingImmediate(false)
          setCursorImmediate((c) => clamp(c - 1, 0, options.length - 1))
          return
        }
        if (key.downArrow) {
          setTypingImmediate(false)
          setCursorImmediate((c) => clamp(c + 1, 0, options.length - 1))
          return
        }
        // Let `TextInput` handle editing + Enter submission.
        return
      }

      if (key.upArrow) {
        setCursorImmediate((c) => clamp(c - 1, 0, options.length - 1))
        return
      }
      if (key.downArrow) {
        setCursorImmediate((c) => clamp(c + 1, 0, options.length - 1))
        return
      }

      if (key.return) {
        const opt = options[currentCursor]
        if (!opt) return
        if (opt.kind === 'feedback') setTypingImmediate(true)
        else submit({ kind: 'choice', key: opt.key })
        return
      }

      if (feedbackIndex === currentCursor && input && !key.ctrl && !key.meta) {
        setTypingImmediate(true)
        setTypingValueImmediate((v) => v + input)
        return
      }

      if (/^[0-9]$/.test(input)) {
        const n = Number.parseInt(input, 10)
        if (!Number.isFinite(n) || n <= 0) return
        const idx = n - 1
        if (idx < 0 || idx >= options.length) return
        setCursorImmediate(idx)
        return
      }
    },
    { isActive: true },
  )

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {options.map((opt, idx) => {
          const active = cursor === idx
          const prefix = active ? '❯ ' : '  '
          const color = active ? theme.text : theme.secondaryText

          if (opt.kind === 'choice') {
            return (
              <Box key={opt.key}>
                <Text>{prefix}</Text>
                <Text color={opt.dim && !active ? theme.secondaryText : color}>
                  {idx + 1}. {opt.label}
                </Text>
              </Box>
            )
          }

          const hasValue = Boolean((typingValue || '').trim())
          const showPlaceholder = !typing && !hasValue
          const labelPrefix = opt.label ? `${idx + 1}. ${opt.label} ` : `${idx + 1}. `
          return (
            <Box key={opt.key}>
              <Text>{prefix}</Text>
              <Text color={color}>{labelPrefix}</Text>
              {showPlaceholder ? (
                <Text color={theme.secondaryText}>{opt.placeholder}</Text>
              ) : typing ? (
                <TextInput
                  value={typingValue}
                  onChange={(next) => setTypingValueImmediate(next)}
                  onSubmit={() =>
                    submit({ kind: 'feedback', key: opt.key, feedback: typingValueRef.current.trim() })
                  }
                  cursorStyle="bar"
                  cursorChar="▏"
                  focus={active}
                />
              ) : (
                <Text color={color}>{typingValue || ''}</Text>
              )}
            </Box>
          )
        })}
      </Box>
      {footer ? (
        <Box marginTop={1}>
          {typeof footer === 'string' ? <Text color={theme.secondaryText}>{footer}</Text> : footer}
        </Box>
      ) : null}
    </Box>
  )
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
