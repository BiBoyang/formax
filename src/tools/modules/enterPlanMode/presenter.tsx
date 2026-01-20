import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { getTheme } from '../../../utils/theme'
import { useUserInputManager } from '../../runtime/userInputContext'
import { useScopeActivation, useScopedInput } from '../../../features/repl/inputScopeContext'

export const EnterPlanModeToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { status } = message.toolInfo
  const toolUseId = message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id

  if (status === 'running') {
    if (!userInput) {
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.secondaryText}>Preparing…</Text>
        </Box>
      )
    }

    return (
      <EnterPlanModePrompt
        onEnter={() => userInput.submitAnswers(toolUseId, { choice: 'enter' })}
        onSkip={() => userInput.submitAnswers(toolUseId, { choice: 'skip' })}
      />
    )
  }

  const resultStr = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  if (status === 'error' && resultStr.includes('Request aborted')) {
    return null
  }

  const entered = resultStr.includes('Entered plan mode')
  const dotColor = entered ? theme.success : theme.secondaryText

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <Text color={dotColor}>⏺</Text>
        <Text bold>{entered ? ' Entered plan mode' : ' Plan mode skipped'}</Text>
      </Box>
      {entered ? (
        <Box>
          <Text color={theme.secondaryText}>  Claude is now exploring and designing an implementation approach.</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function EnterPlanModePrompt({ onEnter, onSkip }: { onEnter: () => void; onSkip: () => void }): React.ReactNode {
  const theme = getTheme()
  const scope = 'prompt:enterPlanMode'
  useScopeActivation(scope)
  const { stdout } = useStdout()
  const separator = useMemo(() => {
    const width = Math.max(20, stdout?.columns ?? 80)
    return '─'.repeat(width)
  }, [stdout?.columns])
  const [cursor, setCursor] = useState(0)
  const submittedRef = useRef(false)

  const submit = useCallback(
    (choice: 'enter' | 'skip') => {
      if (submittedRef.current) return
      submittedRef.current = true
      if (choice === 'enter') onEnter()
      else onSkip()
    },
    [onEnter, onSkip],
  )

  useScopedInput(
    scope,
    (input, key) => {
      if (submittedRef.current) return

      if (key.upArrow) setCursor((c) => Math.max(0, c - 1))
      if (key.downArrow) setCursor((c) => Math.min(1, c + 1))

      if (key.escape) {
        submit('skip')
        return
      }

      if (input === '1') setCursor(0)
      if (input === '2') setCursor(1)

      if (key.return) {
        submit(cursor === 0 ? 'enter' : 'skip')
      }
    },
  )

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.secondaryText}>{separator}</Text>

      <Box flexDirection="column" marginLeft={1}>
        <Text bold>Enter plan mode?</Text>

        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.secondaryText}>
            Claude wants to enter plan mode to explore and design an implementation approach.
          </Text>

          <Box marginTop={1} flexDirection="column">
            <Text color={theme.secondaryText}>In plan mode, Claude will:</Text>
            <Text color={theme.secondaryText}> · Explore the codebase thoroughly</Text>
            <Text color={theme.secondaryText}> · Identify existing patterns</Text>
            <Text color={theme.secondaryText}> · Design an implementation strategy</Text>
            <Text color={theme.secondaryText}> · Present a plan for your approval</Text>
          </Box>

          <Box marginTop={1}>
            <Text color={theme.secondaryText}>No code changes will be made until you approve the plan.</Text>
          </Box>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <MenuRow cursor={cursor === 0} label="1. Yes, enter plan mode" />
          <MenuRow cursor={cursor === 1} label="2. No, start implementing now" />
        </Box>
      </Box>
    </Box>
  )
}

function MenuRow({ cursor, label }: { cursor: boolean; label: string }): React.ReactNode {
  const theme = getTheme()
  return (
    <Box>
      <Text>{cursor ? '❯ ' : '  '}</Text>
      <Text color={cursor ? theme.text : theme.secondaryText}>{label}</Text>
    </Box>
  )
}
