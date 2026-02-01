import fs from 'node:fs'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { getTheme } from '../../../utils/theme'
import { useUserInputManager } from '../../runtime/userInputContext'
import { usePlanSession } from '../../../features/repl/planContext'
import { formatPlanPathForDisplay } from '../../../utils/planMode'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import TextInput from '../../../components/ui/TextInput.js'
import { useScopeActivation, useScopedInput } from '../../../features/repl/inputScopeContext'
import { consumeBufferedArrow } from '../../../features/repl/keys/escapeSequences.js'

export const ExitPlanModeToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
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
        <Box>
          <PulsingDot color={theme.success} />
          <Text bold color={theme.text}>
            User approved Claude's plan
          </Text>
        </Box>

        <Box>
          <Text color={theme.secondaryText}>⎿  </Text>
          <Text color={theme.secondaryText}>
            Plan saved to: {planPathDisplay}
            {modeLabel ? ` · mode: ${modeLabel}` : ''} · /plan to edit
          </Text>
        </Box>

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
      <Box>
        <PulsingDot color={dotColor} />
        <Text bold color={theme.text}>
          {headline}
        </Text>
      </Box>
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
  const [typingValue, setTypingValue] = useState('')
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
      if (submittedRef.current) return
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
      const token = (typeof seq === 'string' && seq.length > 0 ? seq : input) || ''

      // Some terminals (and ink-testing-library) may split arrow sequences across multiple `useInput` calls.
      // Buffer ESC chunks so Up/Down works reliably even when `key.upArrow` isn't set.
      let bufferedDelta = 0
      if ((escapeBufferRef.current || token.startsWith('\u001B')) && !key.upArrow && !key.downArrow) {
        const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
        escapeBufferRef.current = res.nextBuffer
        if (res.pending && res.delta === 0) return
        bufferedDelta = res.delta
      } else if (!token.startsWith('\u001B')) {
        escapeBufferRef.current = ''
      }

      const arrowDelta = (key.upArrow ? -1 : 0) + (key.downArrow ? 1 : 0) + bufferedDelta

      if (typing) {
        if (arrowDelta < 0) {
          setTyping(false)
          setCursorSafe((c) => Math.max(0, c - 1))
          return
        }
        if (arrowDelta > 0) {
          setTyping(false)
          setCursorSafe((c) => Math.min(2, c + 1))
          return
        }
        if (key.escape) {
          setTyping(false)
          return
        }
        // Let `TextInput` handle editing + Enter submission.
        return
      }

      // If we handled navigation, stop here so split escape-sequence chunks (like the final "A"/"B")
      // don't accidentally enter typing mode or trigger numeric shortcuts.
      if (arrowDelta !== 0) {
        setCursorSafe((c) => Math.max(0, Math.min(2, c + arrowDelta)))
        return
      }

      if (key.escape) {
        submit('cancel')
        return
      }

      // When the "custom message" row is selected, any character (including digits)
      // should start editing instead of triggering numeric shortcuts.
      if (cursorRef.current === 2 && input && !key.ctrl && !key.meta) {
        setTyping(true)
        setTypingValue((v) => v + input)
        return
      }

      if (input === '1') setCursorSafe(0)
      if (input === '2') setCursorSafe(1)
      if (input === '3') setCursorSafe(2)

      if (key.return) {
        const resolvedCursor = cursorRef.current
        if (resolvedCursor === 0) submit('auto')
        else if (resolvedCursor === 1) submit('manual')
        else setTyping(true)
      }
    },
  )

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
        <Text bold>Ready to code?</Text>
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
        <MenuRow cursor={cursor === 0} label="1. Yes, and auto-accept edits" />
        <MenuRow cursor={cursor === 1} label="2. Yes, and manually approve edits" />
        <Box>
          <Text>{cursor === 2 ? '❯ ' : '  '}</Text>
          <Text color={cursor === 2 ? theme.text : theme.secondaryText}>3. </Text>
          {typing ? (
            <TextInput
              value={typingValue}
              onChange={setTypingValue}
              onSubmit={(next) => submit('feedback', next.trim())}
              cursorStyle="bar"
              cursorChar="▏"
              focus={cursor === 2}
              scope={scope}
            />
          ) : feedbackLine ? (
            <Text color={cursor === 2 ? theme.text : theme.secondaryText}>{feedbackLine}</Text>
          ) : (
            <Text color={theme.secondaryText}>Type here to tell Claude what to change</Text>
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
