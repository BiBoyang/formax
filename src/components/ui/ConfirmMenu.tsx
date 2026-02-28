import React, { useCallback, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import type { InputScopeId } from '../../features/repl/inputScopeContext'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext'
import { consumeBufferedArrow, consumeBufferedHorizontal } from '../../features/repl/keys/escapeSequences'
import {
  getInputToken,
  getKeyName,
  getVerticalArrowKeyDelta,
  isPrintableToken,
  isReturnKeyToken,
  isShiftTabToken,
} from '../../features/repl/keys/keyTokens'

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
  const [typingCursor, setTypingCursor] = useState(0)
  const [isActive, setIsActive] = useState(true)
  const submittedRef = useRef(false)
  const cursorRef = useRef(initialCursor)
  const typingRef = useRef(false)
  const typingValueRef = useRef('')
  const typingCursorRef = useRef(0)
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

  const setTypingValueImmediate = useCallback((next: string) => {
    typingValueRef.current = next
    setTypingValue(next)
  }, [])

  const setTypingCursorImmediate = useCallback((next: number | ((current: number) => number)) => {
    const currentMax = typingValueRef.current.length
    const v = clamp(typeof next === 'function' ? next(typingCursorRef.current) : next, 0, currentMax)
    typingCursorRef.current = v
    setTypingCursor(v)
  }, [])

  const syncTypingCursorToTail = useCallback(() => {
    const tail = typingValueRef.current.length
    typingCursorRef.current = tail
    setTypingCursor(tail)
  }, [])

  const submit = useCallback(
    (decision: ConfirmMenuDecision) => {
      submittedRef.current = true
      setIsActive(false)
      onDecision(decision)
    },
    [onDecision],
  )

  const appendDraft = useCallback(
    (chunk: string) => {
      if (!chunk) return
      const current = typingValueRef.current
      const cursorPos = clamp(typingCursorRef.current, 0, current.length)
      const nextValue = `${current.slice(0, cursorPos)}${chunk}${current.slice(cursorPos)}`
      setTypingValueImmediate(nextValue)
      setTypingCursorImmediate(cursorPos + chunk.length)
    },
    [setTypingCursorImmediate, setTypingValueImmediate],
  )

  const deleteBackward = useCallback(() => {
    const current = typingValueRef.current
    const cursorPos = clamp(typingCursorRef.current, 0, current.length)
    if (cursorPos <= 0) return
    const nextValue = `${current.slice(0, cursorPos - 1)}${current.slice(cursorPos)}`
    setTypingValueImmediate(nextValue)
    setTypingCursorImmediate(cursorPos - 1)
  }, [setTypingCursorImmediate, setTypingValueImmediate])

  const deleteForward = useCallback(() => {
    const current = typingValueRef.current
    const cursorPos = clamp(typingCursorRef.current, 0, current.length)
    if (cursorPos >= current.length) return
    const nextValue = `${current.slice(0, cursorPos)}${current.slice(cursorPos + 1)}`
    setTypingValueImmediate(nextValue)
    setTypingCursorImmediate(cursorPos)
  }, [setTypingCursorImmediate, setTypingValueImmediate])

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
      const rawInput = typeof input === 'string' ? input : ''
      const token = getInputToken({ input, key })
      const tokenInfo = getTokenInfo({ token, key })
      const printableChunk = rawInput.length > 0 ? rawInput : tokenInfo.token

      if (tokenInfo.isEscape) escapeBufferRef.current = ''

      const isTyping = typingRef.current

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

      if (isShiftTabToken({ token, key: patchedKey }) && onShiftTab) {
        if (isTyping) setTypingImmediate(false)
        onShiftTab()
        setCursorImmediate(clamp(shiftTabCursor, 0, options.length - 1))
        return
      }

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
        let bufferedHorizontalDelta = 0
        let bufferedDeletes = 0
        if (tokenInfo.token && !tokenInfo.isLeftArrowKey && !tokenInfo.isRightArrowKey && !tokenInfo.isDeleteKey) {
          const res = consumeBufferedHorizontal({ buffer: escapeBufferRef.current, chunk: tokenInfo.token })
          escapeBufferRef.current = res.nextBuffer
          if (res.pending && res.delta === 0 && res.deletes === 0) return
          bufferedHorizontalDelta = res.delta
          bufferedDeletes = res.deletes
        }

        if (tokenInfo.isReturnKey) {
          submitDraftIfFeedbackRow()
          return
        }

        if (tokenInfo.isLeftArrowKey || bufferedHorizontalDelta < 0) {
          const move = tokenInfo.isLeftArrowKey ? 1 : Math.abs(bufferedHorizontalDelta)
          setTypingCursorImmediate((c) => c - move)
          return
        }

        if (tokenInfo.isRightArrowKey || bufferedHorizontalDelta > 0) {
          const move = tokenInfo.isRightArrowKey ? 1 : bufferedHorizontalDelta
          setTypingCursorImmediate((c) => c + move)
          return
        }

        if (tokenInfo.isBackspaceKey) {
          deleteBackward()
          return
        }

        if (tokenInfo.isDeleteKey || bufferedDeletes > 0) {
          const deletes = tokenInfo.isDeleteKey ? Math.max(1, bufferedDeletes) : bufferedDeletes
          for (let i = 0; i < deletes; i += 1) deleteForward()
          return
        }

        if (tokenInfo.printable) {
          appendDraft(printableChunk)
        }
        return
      }

      if (tokenInfo.isReturnKey) {
        const opt = options[currentCursor]
        if (!opt) return
        if (opt.kind === 'feedback') {
          setTypingImmediate(true)
          syncTypingCursorToTail()
        } else submit({ kind: 'choice', key: opt.key })
        return
      }

      if (feedbackIndex === currentCursor && tokenInfo.printable) {
        setTypingImmediate(true)
        syncTypingCursorToTail()
        appendDraft(printableChunk)
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
          const hasValue = Boolean((typingValue || '').trim())
          const showPlaceholder = !typing && !hasValue
          const cursorPos = clamp(typingCursor, 0, typingValue.length)
          const valueWithCursor = `${typingValue.slice(0, cursorPos)}▏${typingValue.slice(cursorPos)}`

          return (
            <Box key={opt.key}>
              <Text color={prefixColor}>{prefix}</Text>
              <Text color={color}>{labelPrefix}</Text>
              {showPlaceholder ? (
                <Text color={theme.secondaryText}>{opt.placeholder}</Text>
              ) : typing && active ? (
                <Text color={color}>{valueWithCursor}</Text>
              ) : (
                <Text color={color}>{typingValue}</Text>
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

function getTokenInfo(args: { token: string; key: any }): {
  token: string
  printable: boolean
  isEscape: boolean
  isReturnKey: boolean
  isUpArrowKey: boolean
  isDownArrowKey: boolean
  isLeftArrowKey: boolean
  isRightArrowKey: boolean
  isBackspaceKey: boolean
  isDeleteKey: boolean
} {
  const keyName = getKeyName(args.key)
  const keyDelta = getVerticalArrowKeyDelta(args.key)
  const isEscape = Boolean(args.key?.escape) || keyName === 'escape'

  const token = args.token
  const printable = isPrintableToken({ token, key: args.key })

  return {
    token,
    printable,
    isEscape,
    isReturnKey: isReturnKeyToken({ token, key: args.key }),
    isUpArrowKey: keyDelta < 0,
    isDownArrowKey: keyDelta > 0,
    isLeftArrowKey: Boolean(args.key?.leftArrow) || keyName === 'left' || token === '\u001B[D',
    isRightArrowKey: Boolean(args.key?.rightArrow) || keyName === 'right' || token === '\u001B[C',
    isBackspaceKey: Boolean(args.key?.backspace) || token === '\u0008' || token === '\u007F',
    isDeleteKey: Boolean(args.key?.delete) || keyName === 'delete' || token === '\u001B[3~',
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
