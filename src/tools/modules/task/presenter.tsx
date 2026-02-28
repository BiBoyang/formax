import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenterComponent } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../shared/toolMessageTypes'
import { ToolHeaderLine, ToolIndentedLine, ToolSubline, ToolUiBlocks } from '../../presenters/ToolUiPrimitives'
import { useUserInputManager } from '../../runtime/userInputContext'
import { BashToolPresenter } from '../bash/presenter'
import { WriteToolPresenter } from '../write/presenter'
import { EditToolPresenter } from '../edit/presenter'
import { NotebookEditToolPresenter } from '../notebookEdit/presenter'
import { AskUserQuestionToolPresenter } from '../askUserQuestion/presenter'
import { isToolBlocksPresenter } from '../../presenters/types'

export const TaskToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo

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
      <ToolHeaderLine status={status} label={toolLabel} params={showParams ? params : null} />

      {nestedLines.length > 0 ? (
        <Box flexDirection="column">
          {nestedLines.map((line, i) => (
            <ToolIndentedLine key={i} text={line} />
          ))}
        </Box>
      ) : null}

      {nestedPrompt ? <Box marginTop={1}>{nestedPrompt}</Box> : null}

      {status !== 'running' ? (
        <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
          {status === 'error' ? (
            <Text color={theme.error}>{message.content}</Text>
          ) : (
            <Text>{message.content}</Text>
          )}
        </ToolSubline>
      ) : null}
    </Box>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

function normalizeInlineText(s: string): string {
  return String(s).replace(/\s+/g, ' ').trim()
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

  const presenter =
    args.name === 'Bash'
      ? BashToolPresenter
      : args.name === 'Write'
        ? WriteToolPresenter
        : args.name === 'Edit'
          ? EditToolPresenter
          : args.name === 'NotebookEdit'
            ? NotebookEditToolPresenter
            : args.name === 'AskUserQuestion'
              ? AskUserQuestionToolPresenter
              : null

  if (presenter) {
    if (isToolBlocksPresenter(presenter)) {
      const out = presenter({ message: msg })
      return <ToolUiBlocks blocks={out.blocks} />
    }
    return React.createElement(presenter, { message: msg })
  }

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
