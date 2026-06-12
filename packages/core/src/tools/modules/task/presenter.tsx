import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../tui/theme'
import type { ToolPresenterComponent } from '../../../shared/toolPresenterContracts'
import { FallbackToolPresenter } from '../../../components/tool/FallbackToolPresenter'
import type { Msg } from '../../../shared/toolMessageTypes'
import { ToolHeaderLine, ToolIndentedLine, ToolSubline, ToolUiBlocks } from '../../../components/tool/ToolUiPrimitives'
import {
  formatSubagentDisplayName,
  normalizeSubagentLookupKey,
} from '../../../shared/subagentPresentation'
import { useSubagentPresentationCatalog } from '../../../shared/subagentPresentationContext'
import { useUserInputManager } from '../../runtime/userInputContext'
import { isToolUseActivePrompt } from '../../runtime/userInputManager'
import { BashToolPresenter } from '../bash/presenter'
import { WriteToolPresenter } from '../write/presenter'
import { EditToolPresenter } from '../edit/presenter'
import { NotebookEditToolPresenter } from '../notebookEdit/presenter'
import { AskUserQuestionToolPresenter } from '../askUserQuestion/presenter'
import { isToolBlocksPresenter } from '../../../shared/toolPresenterContracts'

export const TaskToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()
  const subagentPresentation = useSubagentPresentationCatalog()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo

  const subagentType = (input as any)?.subagent_type
  const description = (input as any)?.description
  const prompt = (input as any)?.prompt
  const toolLabel = formatSubagentDisplayName(subagentType)
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
      if (isToolUseActivePrompt(userInput, id)) return { ...t, id }
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

  const progressLines = useMemo(() => {
    return Array.isArray(message.toolInfo?.middleLines) ? message.toolInfo.middleLines : []
  }, [message.toolInfo?.middleLines])

  const nestedLines = useMemo(() => {
    if (progressLines.length > 0) return progressLines

    const nested = message.toolInfo?.nestedTools
    if (!Array.isArray(nested) || nested.length === 0) return []
    return renderExpandedNestedLines(nested)
  }, [message.toolInfo?.nestedTools, progressLines])

  const runningSublineText = useMemo(() => {
    if (status !== 'running') return null
    const { activityLines } = parseRunningProgressLines(progressLines)
    const firstLine = activityLines[0]
    if (firstLine) {
      return firstLine
    }
    return 'Running'
  }, [progressLines, status])

  const visibleNestedLines = useMemo(() => {
    if (status !== 'running') return nestedLines
    const { activityLines, overflowLine, backgroundHintLine } = parseRunningProgressLines(progressLines)
    const lines: string[] = []
    if (activityLines.length > 1) {
      lines.push(activityLines[1]!)
    }
    if (overflowLine) lines.push(overflowLine)
    if (backgroundHintLine) lines.push(backgroundHintLine)
    return lines
  }, [nestedLines, progressLines, status])

  const shouldSuppressPendingTaskPlaceholder =
    status === 'running' &&
    !normalizeSubagentLookupKey(subagentType) &&
    !showParams &&
    !nestedPrompt &&
    progressLines.length === 0

  if (shouldSuppressPendingTaskPlaceholder) return null

  const resolvedLabelBackgroundColor = subagentPresentation.colorByName.get(normalizeSubagentLookupKey(subagentType))
  const resolvedLabelColor = resolvedLabelBackgroundColor ? '#000000' : undefined

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <ToolHeaderLine
        status={status}
        label={toolLabel}
        params={showParams ? params : null}
        labelColor={resolvedLabelColor ?? undefined}
        labelBackgroundColor={resolvedLabelBackgroundColor ?? undefined}
      />

      {status === 'running' && runningSublineText ? (
        <ToolSubline status="completed" text={runningSublineText} />
      ) : null}

      {visibleNestedLines.length > 0 ? (
        <Box flexDirection="column">
          {visibleNestedLines.map((line, i) => (
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

function stripBranchPrefix(line: string): string {
  const text = String(line || '').trim()
  if (!text) return ''
  return text.replace(/^[├└]\s+/, '').trim()
}

function parseRunningProgressLines(lines: string[]): {
  activityLines: string[]
  overflowLine: string | null
  backgroundHintLine: string | null
} {
  const activityLines: string[] = []
  let overflowLine: string | null = null
  let backgroundHintLine: string | null = null

  for (const rawLine of lines) {
    const line = stripBranchPrefix(rawLine)
    if (!line) continue

    if (!overflowLine && /^\+\d+\s+more tool uses?\s+\(ctrl\+o to expand\)$/i.test(line)) {
      overflowLine = line
      continue
    }

    if (!backgroundHintLine && /ctrl\+b to run in background/i.test(line)) {
      backgroundHintLine = line
      continue
    }

    const lastActivity = activityLines[activityLines.length - 1]
    if (lastActivity && normalizeRunningProgressLine(lastActivity) === normalizeRunningProgressLine(line)) {
      continue
    }

    activityLines.push(line)
  }

  return { activityLines, overflowLine, backgroundHintLine }
}

function normalizeRunningProgressLine(line: string): string {
  return String(line || '').trim().toLowerCase()
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
