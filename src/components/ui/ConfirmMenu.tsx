import React, { useCallback, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import { InlineTextEditorRow } from './InlineTextEditorRow.js'
import type { InputScopeId } from '../../features/repl/inputScopeContext'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences'
import { isPrintableToken, isReturnKeyToken } from '../../features/repl/keys/keyTokens'

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

  const appendDraft = useCallback(
    (chunk: string) => {
      if (!chunk) return
      setTypingValueImmediate((v) => v + chunk)
    },
    [setTypingValueImmediate],
  )

  const submitDraftIfFeedbackRow = useCallback(() => {
    const opt = options[cursorRef.current]
    if (opt?.kind !== 'feedback') return
    submit({ kind: 'feedback', key: opt.key, feedback: typingValueRef.current.trim() })
  }, [options, submit])

  useScopedInput(
    scope,
    (input, key) => {
      if (!isActive) return
      if (submittedRef.current) return
      const token = getInputToken({ input, key })
      const tokenInfo = getTokenInfo({ token, key })

      if (tokenInfo.isEscape) escapeBufferRef.current = ''

      const isTyping = typingRef.current

      // Some terminals (and ink-testing-library) may split arrow sequences across multiple `useInput` calls.
      // Buffer ESC chunks so Up/Down always work reliably.
      let bufferedDelta = 0
      if (!isTyping && !tokenInfo.isUpArrowKey && !tokenInfo.isDownArrowKey && tokenInfo.token) {
        const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
        escapeBufferRef.current = res.nextBuffer
        if (res.pending && res.delta === 0) return
        bufferedDelta = res.delta
      }

      const arrowDelta =
        (tokenInfo.isUpArrowKey ? -1 : 0) + (tokenInfo.isDownArrowKey ? 1 : 0) + bufferedDelta

      const patchedKey = key as any
      const currentCursor = cursorRef.current

      // `ink-testing-library` and some terminals provide Shift+Tab as a raw escape sequence
      // (either "\u001B[Z" or "\u001BOZ") instead of `key.shift + key.tab`.
      // Support both so scope cycling is reliable and testable.
      const isShiftTabSequence = token === '\u001B[Z' || token === '\u001BOZ'
      if (((patchedKey.shift && patchedKey.tab) || isShiftTabSequence) && onShiftTab) {
        if (isTyping) setTypingImmediate(false)
        onShiftTab()
        setCursorImmediate(clamp(shiftTabCursor, 0, options.length - 1))
        return
      }

      // Important: handle `key.escape` only when it's a real Escape keypress. In some
      // environments/tests, arrow escape sequences can arrive split across callbacks and
      // the first chunk (`\u001B`) may set `key.escape`. In that case, `token` is non-empty
      // and we must not treat it as cancel.
      if (patchedKey.escape && !token) {
        submit({ kind: 'cancel' })
        return
      }

      if (arrowDelta !== 0) {
        if (isTyping) setTypingImmediate(false)
        setCursorImmediate((c) => clamp(c + arrowDelta, 0, options.length - 1))
        return
      }

      if (isTyping) {
        handleTypingTransitionGuard({
          tokenInfo,
          submitDraftIfFeedbackRow,
          appendDraft,
        })
        return
      }

      if (tokenInfo.isReturnKey) {
        const opt = options[currentCursor]
        if (!opt) return
        if (opt.kind === 'feedback') setTypingImmediate(true)
        else submit({ kind: 'choice', key: opt.key })
        return
      }

      if (feedbackIndex === currentCursor && tokenInfo.printable) {
        setTypingImmediate(true)
        appendDraft(tokenInfo.token)
        return
      }

      const digitIndex = getDigitIndex(tokenInfo.token, options.length)
      if (digitIndex == null) return
      setCursorImmediate(digitIndex)
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

function getInputToken(args: { input: string; key: unknown }): string {
  const seq = (args.key as unknown as { sequence?: string } | undefined)?.sequence
  return (typeof seq === 'string' && seq.length > 0 ? seq : args.input) || ''
}

function getTokenInfo(args: { token: string; key: any }): {
  token: string
  printable: boolean
  isEscape: boolean
  isReturnKey: boolean
  isUpArrowKey: boolean
  isDownArrowKey: boolean
} {
  const keyName = typeof args.key?.name === 'string' ? String(args.key.name) : ''
  const isUpArrowKey = keyName === 'up' || Boolean(args.key?.upArrow)
  const isDownArrowKey = keyName === 'down' || Boolean(args.key?.downArrow)
  const isEscape = Boolean(args.key?.escape) || keyName === 'escape'

  const token = args.token
  const printable = isPrintableToken({ token, key: args.key })

  return {
    token,
    printable,
    isEscape,
    isReturnKey: isReturnKeyToken({ token, key: args.key }),
    isUpArrowKey,
    isDownArrowKey,
  }
}

function getDigitIndex(token: string, optionsLength: number): number | null {
  if (!/^[0-9]$/.test(token)) return null
  const n = Number.parseInt(token, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const idx = n - 1
  if (idx < 0 || idx >= optionsLength) return null
  return idx
}

function handleTypingTransitionGuard(args: {
  tokenInfo: { token: string; printable: boolean; isReturnKey: boolean }
  submitDraftIfFeedbackRow: () => void
  appendDraft: (chunk: string) => void
}): void {
  // Transition guard: `setTyping(true)` happens immediately, but the underlying `TextInput`
  // may not have mounted/registered yet (React batching). If the user types very quickly,
  // we can receive printable input here before `TextInput` is ready. Append in that case so
  // keystrokes aren't dropped; once `TextInput` is mounted it will consume these events and
  // this handler won't run.
  if (args.tokenInfo.isReturnKey) {
    args.submitDraftIfFeedbackRow()
    return
  }

  if (args.tokenInfo.printable) {
    args.appendDraft(args.tokenInfo.token)
  }
}
