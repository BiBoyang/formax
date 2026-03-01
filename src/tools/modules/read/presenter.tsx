import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../../tui/theme'
import { formatToolCallParts } from '../../../shared/utils/toolFormatting'
import { createToolBlocksPresenter } from '../../../shared/toolPresenterContracts'
import type { Msg } from '../../../shared/toolMessageTypes'
import path from 'node:path'
import { formatPathForDisplay } from '../../../shared/utils/paths'
import { pickCompactErrorDetailLine } from '../../utils/toolErrorUi'
import type { ToolBlocksOutput } from '../../../shared/toolMessageTypes'
import { FsReadApprovalToolBlock } from '../../../components/tool/FsReadApprovalToolBlock'

export const ReadToolPresenter = createToolBlocksPresenter(
  ({ message }: { message: Msg }): ToolBlocksOutput => {
  const theme = getTheme()

  if (!message.toolInfo) {
    return {
      blocks: [{ kind: 'header', status: 'completed', label: 'Unknown tool' }],
    }
  }

  const { name, input, status, middleLines, expandInfo } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const displayParams = formatPathForDisplay(params)
  const showParams = Boolean(displayParams && displayParams.trim().length > 0)
  const compactErrorDetail =
    status === 'error' ? pickCompactErrorDetailLine({ middleLines, expandInfo }) : null
  const toolUseId =
    message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)

  const filePathRaw = String((input as any).file_path || (input as any).path || '')

  const blocks: ToolBlocksOutput['blocks'] = [
    { kind: 'header', status, label: toolName, params: showParams ? displayParams : null },
  ]

  if (status === 'running') {
    blocks.push({
      kind: 'custom',
      node: (
        <FsReadApprovalToolBlock
          toolUseId={toolUseId}
          title="Read file"
          directoryPath={path.dirname(filePathRaw || process.cwd())}
        />
      ),
    })
    return { blocks }
  }

  blocks.push({
    kind: 'subline',
    status: status === 'error' ? 'error' : 'completed',
    children: renderReadSummary({ theme, summary: message.content, status }),
  })

  if (status === 'error') {
    if (compactErrorDetail) {
      blocks.push({
        kind: 'lines',
        lines: [{ tone: 'error', text: compactErrorDetail }],
      })
    }
    return { blocks }
  }

  const lines: Array<{ text: string; tone?: 'default' | 'muted' | 'error' }> = []
  if (middleLines) lines.push(...middleLines.map((line) => ({ text: line })))
  if (expandInfo) lines.push({ tone: 'muted', text: expandInfo })
  if (lines.length > 0) blocks.push({ kind: 'lines', lines })

  return { blocks }
})

function renderReadSummary(args: {
  theme: ReturnType<typeof getTheme>
  summary: string
  status: 'running' | 'completed' | 'error'
  }): React.ReactNode {
  const summary = args.summary || ''

  if (args.status === 'error') {
    return <Text color={args.theme.error}>{summary}</Text>
  }

  const m = /^Read\s+(\d+)\s+lines$/.exec(summary.trim())
  if (!m) return <Text>{summary}</Text>

  return (
    <>
      <Text color={args.theme.secondaryText}>Read </Text>
      <Text color={args.theme.text} bold>
        {m[1]}
      </Text>
      <Text color={args.theme.secondaryText}> lines</Text>
    </>
  )
}
