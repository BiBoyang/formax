import React, { useRef, useState } from 'react'
import { Box, Text } from 'ink'
import type { ToolPresenterComponent } from '../../../shared/toolPresenterContracts'
import { FallbackToolPresenter } from '../../../components/tool/FallbackToolPresenter'
import type { Msg } from '../../../shared/toolMessageTypes'
import { getTheme } from '../../../tui/theme'
import { useUserInputManager } from '../../runtime/userInputContext'
import { useScopeActivation, useScopedInput } from '../../../features/repl/inputScopeContext'
import { summarizePlanModeStatus } from '../../../features/tools/presentation/labels'
import { ENTER_PLAN_MODE_PROMPT } from '../../../features/tools/presentation/planModeQuestions'

export const EnterPlanModeToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
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

  const summary = summarizePlanModeStatus({
    kind: 'enter',
    status,
    fallbackSummary: resultStr,
  })
  const entered = summary === 'Entered plan mode'
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
  const question = ENTER_PLAN_MODE_PROMPT.question
  const yesLabel = ENTER_PLAN_MODE_PROMPT.options[0]!.label
  const noLabel = ENTER_PLAN_MODE_PROMPT.options[1]!.label

  const scope = 'prompt:enterPlanMode'
  useScopeActivation(scope)
  const separator = '─'.repeat(80)
  const [cursor, setCursor] = useState(0)
  const submittedRef = useRef(false)

  const submit = (choice: 'enter' | 'skip') => {
    submittedRef.current = true
    if (choice === 'enter') onEnter()
    else onSkip()
  }

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
        <Text bold>{question}</Text>

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
          <MenuRow cursor={cursor === 0} label={`1. ${yesLabel}`} />
          <MenuRow cursor={cursor === 1} label={`2. ${noLabel}`} />
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
