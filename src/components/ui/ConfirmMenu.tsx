import React, { useCallback, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import { InlineTextEditorRow } from './InlineTextEditorRow.js'
import type { InputScopeId } from '../../features/repl/inputScopeContext'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences'

export type ConfirmMenuOption =
  | {
      kind: 'choice'
      key: string
      label: string
      dim?: boolean
      emphasis?: { text: string; color?: string; bold?: boolean }
    }
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
  scope = 'prompt:confirm',
  activeColor,
}: {
  options: ConfirmMenuOption[]
  initialCursor?: number
  onDecision: (decision: ConfirmMenuDecision) => void
  onShiftTab?: () => void
  shiftTabCursor?: number
  footer?: React.ReactNode
  scope?: InputScopeId
  activeColor?: string
}): React.ReactNode {
  const theme = getTheme()
  const [cursor, setCursor] = useState(initialCursor)
  const [typing, setTyping] = useState(false)
  const [typingValue, setTypingValue] = useState('')
  const [isActive, setIsActive] = useState(true)
  const submittedRef = useRef(false)
  const cursorRef = useRef(initialCursor)
  const typingRef = useRef(false)
  const typingValueRef = useRef('')
  const escapeBufferRef = useRef('')

  const feedbackIndex = options.findIndex((o) => o.kind === 'feedback')

  useScopeActivation(scope, isActive)

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
      setIsActive(false)
      onDecision(decision)
    },
    [onDecision],
  )

  useScopedInput(
    scope,
    (input, key) => {
      if (!isActive) return
      if (submittedRef.current) return
      const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
      const token = (typeof seq === 'string' && seq.length > 0 ? seq : input) || ''
      const keyName = typeof (key as any)?.name === 'string' ? String((key as any).name) : ''

      if (key.escape || keyName === 'escape') escapeBufferRef.current = ''

      const isUpArrowKey = keyName === 'up' || Boolean((key as any)?.upArrow)
      const isDownArrowKey = keyName === 'down' || Boolean((key as any)?.downArrow)

      // Some terminals (and ink-testing-library) may split arrow sequences across multiple `useInput` calls.
      // Buffer ESC chunks so Up/Down always work reliably.
      let bufferedUp = false
      let bufferedDown = false
      if (!isUpArrowKey && !isDownArrowKey && token) {
        const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
        escapeBufferRef.current = res.nextBuffer
        if (res.pending) return
        bufferedUp = res.arrow === 'up'
        bufferedDown = res.arrow === 'down'
      }

      const isUp = isUpArrowKey || bufferedUp || token === '\u001B[A' || token === '\u001BOA'
      const isDown = isDownArrowKey || bufferedDown || token === '\u001B[B' || token === '\u001BOB'

      const patchedKey =
        (isUp || isDown) && !(key as any)?.upArrow && !(key as any)?.downArrow
          ? ({ ...key, upArrow: isUp, downArrow: isDown } as any)
          : (key as any)

      const forwardedInput = isUp || isDown ? '' : input
      const currentCursor = cursorRef.current
      const isTyping = typingRef.current

      if (patchedKey.shift && patchedKey.tab && onShiftTab) {
        if (isTyping) setTypingImmediate(false)
        onShiftTab()
        setCursorImmediate(clamp(shiftTabCursor, 0, options.length - 1))
        return
      }

      if (patchedKey.escape) {
        submit({ kind: 'cancel' })
        return
      }

      if (isTyping) {
        // Preserve draft while navigating.
        if (patchedKey.upArrow) {
          setTypingImmediate(false)
          setCursorImmediate((c) => clamp(c - 1, 0, options.length - 1))
          return
        }
        if (patchedKey.downArrow) {
          setTypingImmediate(false)
          setCursorImmediate((c) => clamp(c + 1, 0, options.length - 1))
          return
        }
        // Let `TextInput` handle editing + Enter submission.
        return
      }

      if (patchedKey.upArrow) {
        setCursorImmediate((c) => clamp(c - 1, 0, options.length - 1))
        return
      }
      if (patchedKey.downArrow) {
        setCursorImmediate((c) => clamp(c + 1, 0, options.length - 1))
        return
      }

      if (patchedKey.return) {
        const opt = options[currentCursor]
        if (!opt) return
        if (opt.kind === 'feedback') setTypingImmediate(true)
        else submit({ kind: 'choice', key: opt.key })
        return
      }

      if (feedbackIndex === currentCursor && forwardedInput && !patchedKey.ctrl && !patchedKey.meta) {
        setTypingImmediate(true)
        setTypingValueImmediate((v) => v + forwardedInput)
        return
      }

      if (/^[0-9]$/.test(forwardedInput)) {
        const n = Number.parseInt(forwardedInput, 10)
        if (!Number.isFinite(n) || n <= 0) return
        const idx = n - 1
        if (idx < 0 || idx >= options.length) return
        setCursorImmediate(idx)
        return
      }
    },
    { enabled: isActive },
  )

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {options.map((opt, idx) => {
          const active = cursor === idx
          const prefix = active ? '❯ ' : '  '
          const color = active ? (activeColor ?? theme.text) : theme.secondaryText
          const prefixColor = active ? (activeColor ?? theme.text) : undefined

          if (opt.kind === 'choice') {
            const emphasisText = opt.emphasis?.text ? String(opt.emphasis.text) : ''
            const hasEmphasis = Boolean(emphasisText && opt.label.includes(emphasisText))

            return (
              <Box key={opt.key}>
                <Text color={prefixColor}>{prefix}</Text>
                {hasEmphasis ? (
                  (() => {
                    const index = opt.label.indexOf(emphasisText)
                    const before = opt.label.slice(0, index)
                    const after = opt.label.slice(index + emphasisText.length)
                    const baseColor = opt.dim && !active ? theme.secondaryText : color
                    const emphasisColor = active ? baseColor : (opt.emphasis?.color ?? theme.text)
                    const emphasisBold = Boolean(opt.emphasis?.bold)

                    return (
                      <>
                        <Text color={baseColor}>
                          {idx + 1}. {before}
                        </Text>
                        <Text color={emphasisColor} bold={emphasisBold}>
                          {emphasisText}
                        </Text>
                        <Text color={baseColor}>{after}</Text>
                      </>
                    )
                  })()
                ) : (
                  <Text color={opt.dim && !active ? theme.secondaryText : color}>
                    {idx + 1}. {opt.label}
                  </Text>
                )}
              </Box>
            )
          }

          const labelPrefix = opt.label ? `${idx + 1}. ${opt.label} ` : `${idx + 1}. `
          return (
            <InlineTextEditorRow
              key={opt.key}
              prefix={prefix}
              labelPrefix={labelPrefix}
              placeholder={opt.placeholder}
              value={typingValue}
              typing={typing}
              active={active}
              color={color}
              placeholderColor={theme.secondaryText}
              onChange={(next) => setTypingValueImmediate(next)}
              onSubmit={() => submit({ kind: 'feedback', key: opt.key, feedback: typingValueRef.current.trim() })}
              scope={scope}
            />
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
