import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import { useUserInputManager } from '../../runtime/userInputContext'
import { BashToolPresenter } from '../bash/presenter'
import { WriteToolPresenter } from '../write/presenter'
import { EditToolPresenter } from '../edit/presenter'
import { NotebookEditToolPresenter } from '../notebookEdit/presenter'
import { AskUserQuestionToolPresenter } from '../askUserQuestion/presenter'

export const TaskToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo

  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  const subagentType = (input as any)?.subagent_type
  const description = (input as any)?.description
  const prompt = (input as any)?.prompt
  const toolLabel = getTaskDisplayName(subagentType)
  const paramsRaw =
    typeof description === 'string' && description.trim()
      ? description.trim()
      : typeof prompt === 'string' && prompt.trim()
        ? prompt.trim()
        : ''
  const params = paramsRaw ? truncate(normalizeInlineText(paramsRaw), 60) : ''

  const pendingNested = useMemo(() => {
    if (!userInput) return null
    if (status !== 'running') return null
    const nested = message.toolInfo?.nestedTools
    if (!Array.isArray(nested) || nested.length === 0) return null

    for (const t of nested) {
      const id = typeof t?.id === 'string' ? t.id : String(t?.id || '')
      if (!id) continue
      if (t?.status !== 'running') continue
      if (userInput.isPending(id)) return { ...t, id }
    }
    return null
  }, [message.toolInfo?.nestedTools, status, userInput])

  const nestedPrompt = pendingNested
    ? renderNestedPrompt({
        id: pendingNested.id,
        name: pendingNested.name,
        input: pendingNested.input,
      })
    : null

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Text wrap="truncate-end">
        <PulsingDot color={dotColor} pulse={status === 'running'} />
        <Text bold>{toolLabel}</Text>
        <Text color={theme.secondaryText}>(</Text>
        <Text color={theme.secondaryText}>{params}</Text>
        <Text color={theme.secondaryText}>)</Text>
      </Text>

      {message.toolInfo.middleLines && message.toolInfo.middleLines.length > 0 ? (
        <Box flexDirection="column">
          {message.toolInfo.middleLines.map((line, i) => (
            <Box key={i}>
              <Text>   {line}</Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {nestedPrompt ? <Box marginTop={1}>{nestedPrompt}</Box> : null}

      {status !== 'running' ? (
        <Box>
          <Text color={theme.secondaryText}>⎿  </Text>
          {status === 'error' ? (
            <Text color={theme.error}>{message.content}</Text>
          ) : (
            <Text>{message.content}</Text>
          )}
        </Box>
      ) : null}
    </Box>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

function normalizeInlineText(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim()
}

function getTaskDisplayName(subagentType: unknown): string {
  const raw = typeof subagentType === 'string' ? subagentType.trim() : ''
  if (!raw) return 'Task'
  if (raw === 'code-reviewer') return 'Reviewer'
  return raw
}

function renderNestedPrompt(args: { id: string; name: string; input: Record<string, any> }): React.ReactNode {
  const msg: Msg = {
    id: `tool-${args.id}`,
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: args.name,
      toolUseId: args.id,
      input: args.input || {},
      status: 'running',
    },
  }

  if (args.name === 'Bash') return <BashToolPresenter message={msg} />
  if (args.name === 'Write') return <WriteToolPresenter message={msg} />
  if (args.name === 'Edit') return <EditToolPresenter message={msg} />
  if (args.name === 'NotebookEdit') return <NotebookEditToolPresenter message={msg} />
  if (args.name === 'AskUserQuestion') return <AskUserQuestionToolPresenter message={msg} />

  return (
    <Box flexDirection="column">
      <Text>Waiting for input: {args.name}</Text>
    </Box>
  )
}
