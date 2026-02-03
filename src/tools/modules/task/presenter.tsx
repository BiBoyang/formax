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
import { TOOL_SUBLINE_INDENT, TOOL_SUBLINE_LEFT_PAD, TOOL_SUBLINE_PREFIX } from '../../../utils/toolUi'

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
  const showParams = Boolean(params && params.trim().length > 0)

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

  const nestedLines = useMemo(() => {
    if (message.toolInfo?.middleLines?.length) return message.toolInfo.middleLines

    const nested = message.toolInfo?.nestedTools
    if (!Array.isArray(nested) || nested.length === 0) return []
    return renderExpandedNestedLines(nested)
  }, [message.toolInfo?.middleLines, message.toolInfo?.nestedTools])

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <Text>
          <PulsingDot color={dotColor} pulse={status === 'running'} />
          <Text bold color={theme.text}>
            {' '}
            {toolLabel}
          </Text>
          {showParams ? <Text color={theme.secondaryText}>({params})</Text> : null}
        </Text>
      </Box>

      {nestedLines.length > 0 ? (
        <Box flexDirection="column">
          {nestedLines.map((line, i) => (
            <Box key={i} paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
              <Text>
                {TOOL_SUBLINE_INDENT}
                {line}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {nestedPrompt ? <Box marginTop={1}>{nestedPrompt}</Box> : null}

      {status !== 'running' ? (
        <Box paddingLeft={TOOL_SUBLINE_LEFT_PAD}>
          <Text>
            <Text color={theme.secondaryText}>{TOOL_SUBLINE_PREFIX}</Text>
            {status === 'error' ? (
              <Text color={theme.error}>{message.content}</Text>
            ) : (
              <Text>{message.content}</Text>
            )}
          </Text>
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

function renderExpandedNestedLines(
  nested: Array<{
    id: string
    name: string
    input: Record<string, any>
    status: 'running' | 'completed' | 'error'
    summary?: string
  }>,
): string[] {
  const items = nested.slice(0, 50)
  return items.map((e, idx) => {
    const branch = idx === items.length - 1 ? '└' : '├'
    const text =
      e.status !== 'running' && e.summary
        ? normalizeInlineText(e.summary)
        : normalizeInlineText(formatNestedHeader(e.name, e.input))
    return `${branch} ${truncate(text, 80)}`
  })
}

function formatNestedHeader(name: string, input: Record<string, any>): string {
  // Keep this lightweight; detailed formatting lives in the subagent handler.
  const tool = String(name || '').trim() || 'Tool'
  const args =
    input && typeof input === 'object' && Object.keys(input).length > 0
      ? Object.entries(input)
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(', ')
      : ''
  return args ? `${tool}(${args})` : `${tool}()`
}
