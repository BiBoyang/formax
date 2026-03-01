import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../../shared/utils/theme'
import { formatToolCallParts } from '../../../shared/utils/toolFormatting'
import { createToolBlocksPresenter } from '../../../shared/toolPresenterContracts'
import type { Msg } from '../../../shared/toolMessageTypes'
import { extractFilepathsFromCommandOutput } from './filepaths'
import { BashApprovalToolBlock } from '../../../components/tool/BashApprovalToolBlock'
import { pickCompactErrorDetailLine } from '../../../shared/utils/toolErrorUi'
import type { ToolBlocksOutput } from '../../../shared/toolMessageTypes'
import { buildBashParamsFromInput } from '../../../features/tools/presentation/bashParams'

function parseBashInput(input: unknown): { command: string; cwd: string | null } {
  const rec = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null
  const command = typeof rec?.command === 'string' ? rec.command : ''
  const cwd = typeof rec?.cwd === 'string' && rec.cwd.trim() ? rec.cwd : null
  return { command, cwd }
}

export const BashToolPresenter = createToolBlocksPresenter(
  ({ message }: { message: Msg }): ToolBlocksOutput => {
    const theme = getTheme()

    if (!message.toolInfo) {
      return {
        blocks: [{ kind: 'header', status: 'completed', label: 'Unknown tool' }],
      }
    }

    const { name, input, status, middleLines, expandInfo } = message.toolInfo
    const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
    const showParams = Boolean(params && params.trim().length > 0)
    const toolUseId =
      message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

    const parsedInput = parseBashInput(input)
    const bashParams = buildBashParamsFromInput(input)
    const command = parsedInput.command || bashParams.command || ''
    const cwd = parsedInput.cwd ?? process.cwd()

    const blocks: ToolBlocksOutput['blocks'] = [
      { kind: 'header', status, label: toolName, params: showParams ? params : null },
    ]

    if (status === 'running') {
      blocks.push({
        kind: 'custom',
        node: (
          <BashApprovalToolBlock
            toolUseId={toolUseId}
            title="Approve running this command?"
            command={command}
            cwd={cwd}
          />
        ),
      })
      return { blocks }
    }

    const rawResult = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
    const bg = parseBackgroundBashResult(rawResult)
    const fileExtract =
      status !== 'error' && !bg
        ? extractFilepathsFromCommandOutput({ command, output: rawResult })
        : null
    const fileSummary = fileExtract && fileExtract.filepaths.length > 0 ? formatFileSummary(fileExtract.filepaths) : null
    const compactErrorDetail =
      status === 'error' ? pickCompactErrorDetailLine({ middleLines, expandInfo }) : null

    blocks.push({
      kind: 'subline',
      status: status === 'error' ? 'error' : 'completed',
      children: renderBashSummary({ theme, summary: message.content, status, bg }),
    })

    if (!bg && fileSummary) {
      blocks.push({
        kind: 'lines',
        lines: [{ tone: 'muted', text: fileSummary }],
      })
    }

    if (!bg && status === 'error') {
      if (compactErrorDetail) {
        blocks.push({
          kind: 'lines',
          lines: [{ tone: 'error', text: compactErrorDetail }],
        })
      }
    } else if (!bg) {
      const lines: Array<{ text: string; tone?: 'default' | 'muted' | 'error' }> = []
      if (middleLines) lines.push(...middleLines.map((line) => ({ text: line })))
      if (expandInfo) lines.push({ tone: 'muted', text: expandInfo })
      if (lines.length > 0) {
        blocks.push({ kind: 'lines', lines })
      }
    }

    return { blocks }
  },
)

function renderBashSummary(args: {
  theme: ReturnType<typeof getTheme>
  summary: string
  status: 'running' | 'completed' | 'error'
  bg: { task_id: string } | null
}): React.ReactNode {
  const summary = args.summary || ''

  if (args.status === 'error') {
    return <Text color={args.theme.error}>{summary}</Text>
  }

  if (args.bg) {
    return (
      <Text>
        Started background task <Text bold>{args.bg.task_id}</Text>
      </Text>
    )
  }

  return <Text>{summary}</Text>
}

function parseBackgroundBashResult(raw: string): { task_id: string } | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed?.status !== 'running') return null
    const taskId = parsed?.task_id
    if (typeof taskId !== 'string' || !taskId.trim()) return null
    return { task_id: taskId }
  } catch {
    return null
  }
}

function formatFileSummary(filepaths: string[]): string {
  const unique = Array.from(new Set(filepaths.filter(Boolean)))
  const shown = unique.slice(0, 3)
  const rest = unique.length - shown.length
  const suffix = rest > 0 ? ` (+${rest} more)` : ''
  return `Files: ${shown.join(', ')}${suffix}`
}
