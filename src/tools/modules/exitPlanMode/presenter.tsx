import fs from 'node:fs'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import type { ToolPresenterComponent } from '../../../shared/toolPresenterContracts'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../shared/toolMessageTypes'
import { getTheme } from '../../../shared/utils/theme'
import { useUserInputManager } from '../../runtime/userInputContext'
import { usePlanSession } from '../../../features/repl/planContext'
import { formatPlanPathForDisplay } from '../../../shared/utils/planMode'
import { ToolHeaderLine, ToolSubline } from '../../presenters/ToolUiPrimitives'
import { useScopeActivation, useScopedInput } from '../../../features/repl/inputScopeContext'
import { consumeBufferedArrow, consumeBufferedHorizontal } from '../../../features/repl/keys/escapeSequences.js'
import { isDeleteOrBackspaceToken, isPrintableToken, isReturnKeyToken } from '../../../features/repl/keys/keyTokens'
import { resolveInteractivePromptModel } from '../../../features/tools/presentation/interactivePrompts'

export const ExitPlanModeToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()
  const planSession = usePlanSession()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { status } = message.toolInfo
  const toolUseId = message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id

  const planPath = planSession?.getPlanPath() ?? null
  const planText = useMemo(() => (planPath ? safeReadFile(planPath) : ''), [planPath])

  if (status === 'running') {
    if (!userInput) {
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.secondaryText}>Preparing…</Text>
        </Box>
      )
    }

    return (
      <ExitPlanModePrompt
        planText={planText}
        onAuto={() => userInput.submitAnswers(toolUseId, { choice: 'auto' })}
        onManual={() => userInput.submitAnswers(toolUseId, { choice: 'manual' })}
        onFeedback={(feedback) => userInput.submitAnswers(toolUseId, { choice: 'feedback', feedback })}
        onCancel={() => userInput.submitAnswers(toolUseId, { choice: 'cancel' })}
      />
    )
  }

  const resultStr = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  if (status === 'error' && resultStr.includes('Request aborted')) {
    return null
  }

  const approved = status !== 'error' && resultStr.includes('User has approved your plan')
  if (approved) {
    const planPathDisplay = planPath ? formatPlanPathForDisplay(planPath) : '(unknown plan file)'
    const planBody = (planText || '').trimEnd() || '(empty plan)'
    const indented = indentBlock(planBody, 5, MAX_PLAN_APPROVED_LINES)
    const modeLabel = resultStr.includes('auto-accept')
      ? 'auto-accept edits'
      : resultStr.includes('manual edit')
        ? 'manual approvals'
        : null

    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <ToolHeaderLine status="completed" label={"User approved Claude's plan"} dotColor={theme.success} pulse={false} />

        <ToolSubline status="completed">
          <Text color={theme.secondaryText}>
            Plan saved to: {planPathDisplay}
            {modeLabel ? ` · mode: ${modeLabel}` : ''} · /plan to edit
          </Text>
        </ToolSubline>

        <Box>
          <Text>{indented}</Text>
        </Box>
      </Box>
    )
  }

  const dotColor = status === 'error' ? theme.error : theme.secondaryText
  const headline = status === 'error' ? 'ExitPlanMode error' : 'ExitPlanMode'
  const firstLine = (resultStr || message.content || '').split('\n')[0] || ''

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <ToolHeaderLine status={status === 'error' ? 'error' : 'completed'} label={headline} dotColor={dotColor} pulse={false} />
      {firstLine ? (
        <Box marginLeft={2}>
          <Text color={theme.secondaryText}>{firstLine}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function ExitPlanModePrompt({
  planText,
  onAuto,
  onManual,
  onFeedback,
  onCancel,
}: {
  planText: string
  onAuto: () => void
  onManual: () => void
  onFeedback: (text: string) => void
  onCancel: () => void
}): React.ReactNode {
  const theme = getTheme()
  const model = resolveInteractivePromptModel({ toolName: 'ExitPlanMode', input: {} })
  const question =
    model?.kind === 'exit_plan_mode' ? model.question : 'Would you like to exit plan mode and start implementation?'
  const autoLabel =
    model?.kind === 'exit_plan_mode'
      ? (model.options.find((option) => option.choice === 'auto')?.label ?? 'Yes, and auto-accept edits')
      : 'Yes, and auto-accept edits'
  const manualLabel =
    model?.kind === 'exit_plan_mode'
      ? (model.options.find((option) => option.choice === 'manual')?.label ?? 'Yes, and manually approve edits')
      : 'Yes, and manually approve edits'
  const feedbackPlaceholder =
    model?.kind === 'exit_plan_mode'
      ? (model.options.find((option) => option.choice === 'feedback')?.label ??
        'Type here to tell Claude what to change')
      : 'Type here to tell Claude what to change'

  const scope = 'prompt:exitPlanMode'
  useScopeActivation(scope)
  const { stdout } = useStdout()
  const separator = useMemo(() => {
    const width = Math.max(20, stdout?.columns ?? 80)
    return '─'.repeat(width)
  }, [stdout?.columns])
  const planDivider = useMemo(() => {
    const width = Math.max(20, stdout?.columns ?? 80)
    return '╌'.repeat(width)
  }, [stdout?.columns])

  const [cursor, setCursor] = useState(0) // 0..2
  const cursorRef = useRef(0)
  const [typing, setTyping] = useState(false)
  const [typingState, setTypingState] = useState({ value: '', cursor: 0 })
  const submittedRef = useRef(false)
  const escapeBufferRef = useRef('')

  const setCursorSafe = useCallback((next: number | ((c: number) => number)) => {
    if (typeof next === 'number') {
      cursorRef.current = next
      setCursor(next)
      return
    }

    setCursor((prev) => {
      const resolved = next(prev)
      cursorRef.current = resolved
      return resolved
    })
  }, [])

  const submit = useCallback(
    (kind: 'auto' | 'manual' | 'feedback' | 'cancel', feedback?: string) => {
      submittedRef.current = true
      if (kind === 'auto') onAuto()
      else if (kind === 'manual') onManual()
      else if (kind === 'feedback') onFeedback(feedback || '')
      else onCancel()
    },
    [onAuto, onCancel, onFeedback, onManual],
  )

  useScopedInput(
    scope,
    (input, key) => {
      if (submittedRef.current) return
      const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
      const rawInput = typeof input === 'string' ? input : ''
      const rawSeq = typeof seq === 'string' ? seq : ''
      const token = (rawInput.length > 0 ? rawInput : rawSeq) || ''
      const keyName = typeof (key as any)?.name === 'string' ? String((key as any).name) : ''

      // Some terminals (and ink-testing-library) may split arrow sequences across multiple `useInput` calls.
      // Buffer ESC chunks so arrows/delete work reliably even when key flags are unset.
      let bufferedVerticalDelta = 0
      let bufferedHorizontalDelta = 0
      let bufferedDeletes = 0
      if (
        (escapeBufferRef.current || token.startsWith('\u001B')) &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow
      ) {
        const horiz = consumeBufferedHorizontal({ buffer: escapeBufferRef.current, chunk: token })
        if (horiz.pending && horiz.delta === 0 && horiz.deletes === 0) {
          escapeBufferRef.current = horiz.nextBuffer
          return
        }
        if (horiz.delta !== 0 || horiz.deletes !== 0) {
          escapeBufferRef.current = horiz.nextBuffer
          bufferedHorizontalDelta = horiz.delta
          bufferedDeletes = horiz.deletes
        } else {
          const vert = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
          escapeBufferRef.current = vert.nextBuffer
          if (vert.pending && vert.delta === 0) return
          bufferedVerticalDelta = vert.delta
        }
      } else if (!token.startsWith('\u001B')) {
        escapeBufferRef.current = ''
      }

      const verticalDelta = (key.upArrow ? -1 : 0) + (key.downArrow ? 1 : 0) + bufferedVerticalDelta
      const horizontalDelta =
        (key.leftArrow ? -1 : 0) + (key.rightArrow ? 1 : 0) + bufferedHorizontalDelta

      if (typing) {
        if (verticalDelta < 0) {
          setTyping(false)
          setCursorSafe((c) => Math.max(0, c - 1))
          return
        }
        if (verticalDelta > 0) {
          setTyping(false)
          setCursorSafe((c) => Math.min(2, c + 1))
          return
        }
        if (horizontalDelta !== 0) {
          setTypingState((state) => ({
            ...state,
            cursor: Math.max(0, Math.min(state.value.length, state.cursor + horizontalDelta)),
          }))
          return
        }
        if (key.escape) {
          setTyping(false)
          return
        }
        const isForwardDelete = bufferedDeletes > 0 || keyName === 'delete' || token === '\u001B[3~'
        if (isForwardDelete) {
          setTypingState((state) => applyForwardDelete(state, bufferedDeletes))
          return
        }
        const isBackspaceLike =
          isDeleteOrBackspaceToken({ token, key }) &&
          keyName !== 'delete' &&
          token !== '\u001B[3~'
        if (isBackspaceLike) {
          setTypingState((state) => {
            if (state.cursor <= 0) return state
            const nextValue = state.value.slice(0, state.cursor - 1) + state.value.slice(state.cursor)
            return { value: nextValue, cursor: Math.max(0, state.cursor - 1) }
          })
          return
        }
        if (isReturnKeyToken({ token, key })) {
          submit('feedback', typingState.value.trim())
          return
        }
        if (isPrintableToken({ token, key })) {
          setTypingState((state) => {
            const nextValue = state.value.slice(0, state.cursor) + token + state.value.slice(state.cursor)
            return { value: nextValue, cursor: state.cursor + token.length }
          })
          return
        }
      } else {
        // If we handled navigation, stop here so split escape-sequence chunks (like the final "A"/"B")
        // don't accidentally enter typing mode or trigger numeric shortcuts.
        if (verticalDelta !== 0) {
          setCursorSafe((c) => Math.max(0, Math.min(2, c + verticalDelta)))
          return
        }

        if (key.escape) {
          submit('cancel')
          return
        }

        // When the "custom message" row is selected, any character (including digits)
        // should start editing instead of triggering numeric shortcuts.
        if (cursorRef.current === 2 && isPrintableToken({ token, key })) {
          setTyping(true)
          setTypingState((state) => {
            const cursorAtEnd = state.value.length
            const nextValue = state.value + token
            return { value: nextValue, cursor: cursorAtEnd + token.length }
          })
          return
        }

        if (input === '1') setCursorSafe(0)
        if (input === '2') setCursorSafe(1)
        if (input === '3') setCursorSafe(2)

        if (key.return) {
          const resolvedCursor = cursorRef.current
          if (resolvedCursor === 0) submit('auto')
          else if (resolvedCursor === 1) submit('manual')
          else {
            setTyping(true)
            setTypingState((state) => ({ ...state, cursor: state.value.length }))
          }
        }
      }
    },
  )

  const typingValue = typingState.value
  const typingCursor = Math.max(0, Math.min(typingState.cursor, typingValue.length))
  const typingBeforeCursor = typingValue.slice(0, typingCursor)
  const typingAfterCursor = typingValue.slice(typingCursor)
  const feedbackLine = typingValue.trim() ? typingValue.trim() : ''
  const planBody = useMemo(() => {
    const raw = (planText || '').trimEnd()
    if (!raw) return '(empty plan)'
    const lines = raw.split(/\r?\n/)
    if (lines.length <= MAX_PLAN_PROMPT_LINES) return raw
    return (
      lines.slice(0, MAX_PLAN_PROMPT_LINES).join('\n') +
      `\n… (${lines.length - MAX_PLAN_PROMPT_LINES} more lines)`
    )
  }, [planText])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.secondaryText}>{separator}</Text>

      <Box flexDirection="column" marginTop={1} marginLeft={1}>
        <Text bold>{question}</Text>
      </Box>

      <Box flexDirection="column" marginLeft={1} marginTop={1}>
        <Text color={theme.secondaryText}>Here is Claude's plan:</Text>
      </Box>

      <Text color={theme.secondaryText}>{planDivider}</Text>
      <Box flexDirection="column" marginLeft={1}>
        <Text>{planBody}</Text>
      </Box>
      <Text color={theme.secondaryText}>{planDivider}</Text>

      <Box flexDirection="column" marginLeft={1} marginTop={1} marginBottom={1}>
        <Text color={theme.secondaryText}>Would you like to proceed?</Text>
      </Box>

      <Box flexDirection="column" marginLeft={1}>
        <MenuRow cursor={cursor === 0} label={`1. ${autoLabel}`} />
        <MenuRow cursor={cursor === 1} label={`2. ${manualLabel}`} />
        <Box>
          <Text>{cursor === 2 ? '❯ ' : '  '}</Text>
          <Text color={cursor === 2 ? theme.text : theme.secondaryText}>3. </Text>
          {typing ? (
            <Text color={theme.text}>
              {typingBeforeCursor}
              ▏
              {typingAfterCursor}
            </Text>
          ) : feedbackLine ? (
            <Text color={cursor === 2 ? theme.text : theme.secondaryText}>{feedbackLine}</Text>
          ) : (
            <Text color={theme.secondaryText}>{feedbackPlaceholder}</Text>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Esc to cancel · ctrl-g to edit in VS Code</Text>
      </Box>
    </Box>
  )
}

function MenuRow({ cursor, label, dim }: { cursor: boolean; label: string; dim?: boolean }): React.ReactNode {
  const theme = getTheme()
  const color = cursor ? theme.text : dim ? theme.secondaryText : theme.secondaryText
  return (
    <Box>
      <Text>{cursor ? '❯ ' : '  '}</Text>
      <Text color={color}>{label}</Text>
    </Box>
  )
}

const MAX_PLAN_PROMPT_LINES = 80
const MAX_PLAN_APPROVED_LINES = 40

function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

function indentBlock(text: string, spaces: number, maxLines: number): string {
  const prefix = ' '.repeat(Math.max(0, spaces))
  const rawLines = String(text || '').split(/\r?\n/)
  const visible = rawLines.slice(0, Math.max(0, maxLines))
  const out = visible.map((line) => prefix + line).join('\n')
  if (rawLines.length <= visible.length) return out
  return out + `\n${prefix}… (${rawLines.length - visible.length} more lines)`
}

type TypingState = { value: string; cursor: number }

function applyForwardDelete(state: TypingState, bufferedDeletes: number): TypingState {
  const deleteCount = Math.max(1, bufferedDeletes)
  const boundedCursor = Math.max(0, Math.min(state.value.length, state.cursor))
  const deleteTo = Math.min(state.value.length, boundedCursor + deleteCount)
  const nextValue = state.value.slice(0, boundedCursor) + state.value.slice(deleteTo)
  if (nextValue === state.value && boundedCursor === state.cursor) return state
  return { value: nextValue, cursor: boundedCursor }
}

export const __testOnlyExitPlanMode = {
  ExitPlanModePrompt,
  MenuRow,
  indentBlock,
  applyForwardDelete,
}
