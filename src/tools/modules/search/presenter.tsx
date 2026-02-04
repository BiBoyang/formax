import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { formatToolCallParts } from '../../../utils/toolFormatting'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { ToolHeaderLine } from '../../../components/tool/ToolHeaderLine'
import { ToolSubline } from '../../../components/tool/ToolSubline'

export const SearchToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { name, input, status } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const showParams = Boolean(params && params.trim().length > 0)

  return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <ToolHeaderLine status={status} label={toolName} params={showParams ? params : null} />

      {status !== 'running' && (
        <Box flexDirection="column">
          <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
            {renderSearchSummary({ theme, summary: message.content, status })}
          </ToolSubline>
        </Box>
      )}
    </Box>
  )
}

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
