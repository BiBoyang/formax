import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import { createToolBlocksPresenter } from '../../presenters/types'
import type { Msg } from '../../../shared/toolMessageTypes'
import type { ToolBlocksOutput } from '../../../shared/toolMessageTypes'

export const SearchToolPresenter = createToolBlocksPresenter(
  ({ message }: { message: Msg }): ToolBlocksOutput => {
  const theme = getTheme()

  if (!message.toolInfo) {
    return {
      blocks: [{ kind: 'header', status: 'completed', label: 'Unknown tool' }],
    }
  }

  const { name, input, status } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })

  const blocks: ToolBlocksOutput['blocks'] = [
    { kind: 'header', status, label: toolName, params },
  ]

  if (status !== 'running') {
    blocks.push({
      kind: 'subline',
      status: status === 'error' ? 'error' : 'completed',
      children: renderSearchSummary({ theme, summary: message.content, status }),
    })
  }

  return { blocks }
})

function renderSearchSummary(args: {
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
