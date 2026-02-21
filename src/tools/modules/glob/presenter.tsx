import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { createToolBlocksPresenter } from '../../presenters/types'
import type { Msg } from '../../../components/tool/ToolMessage'
import { pickCompactErrorDetailLine } from '../../../utils/toolErrorUi'
import type { ToolBlocksOutput } from '../../../components/tool/toolUiBlocksTypes'
import { FsReadApprovalToolBlock } from '../../presenters/FsReadApprovalToolBlock'

export const GlobToolPresenter = createToolBlocksPresenter(
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
  const compactErrorDetail =
    status === 'error' ? pickCompactErrorDetailLine({ middleLines, expandInfo }) : null

  const blocks: ToolBlocksOutput['blocks'] = [
    { kind: 'header', status, label: toolName, params: showParams ? params : null },
  ]

  if (status === 'running') {
    const rawPath = String((input as any)?.path || '')
    blocks.push({
      kind: 'custom',
      node: (
        <FsReadApprovalToolBlock
          toolUseId={toolUseId}
          title={`Approve this ${toolName} call?`}
          directoryPath={rawPath || process.cwd()}
        />
      ),
    })
    return { blocks }
  }

  blocks.push({
    kind: 'subline',
    status: status === 'error' ? 'error' : 'completed',
    children: renderGlobSummary({ theme, summary: message.content, status }),
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

  return { blocks }
})

function renderGlobSummary(args: {
  theme: ReturnType<typeof getTheme>
  summary: string
  status: 'running' | 'completed' | 'error'
}): React.ReactNode {
  const summary = args.summary || ''

  if (args.status === 'error') return <Text color={args.theme.error}>{summary}</Text>

  const m = /^Found\s+(\d+)\s+files$/.exec(summary.trim())
  if (!m) return <Text>{summary}</Text>

  return (
    <>
      <Text color={args.theme.secondaryText}>Found </Text>
      <Text color={args.theme.text} bold>
        {m[1]}
      </Text>
      <Text color={args.theme.secondaryText}> files</Text>
    </>
  )
}
