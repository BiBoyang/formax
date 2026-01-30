import React from 'react'
import { Box, Text } from 'ink'
import type { Msg } from '../../components/tool/ToolMessage'
import { getTheme } from '../../utils/theme'
import { formatTokens, sumTokens, truncate } from './format'

export function ThinkingPanel({ messages }: { messages: Msg[] }): React.ReactNode {
  const theme = getTheme()

  const thinking = (Array.isArray(messages) ? messages : []).filter((m) => {
    if (m.role !== 'assistant') return false
    if (m.ui?.kind !== 'thinking_block') return false
    return Boolean(m.content && m.content.trim())
  })

  if (thinking.length === 0) return null

  return (
    <Box flexDirection="column" marginTop={1}>
      {thinking.map((m) => (
        <Box key={m.id} flexDirection="column" marginBottom={1}>
          <Text color={theme.secondaryText}>∴ Thinking…</Text>
          <Box>
            <Text> </Text>
          </Box>
          <Box flexDirection="column">
            {String(m.content)
              .trimEnd()
              .split('\n')
              .map((line, idx) => (
                <Text key={idx} color={theme.secondaryText}>
                  {line ? `  ${line}` : ' '}
                </Text>
              ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

export function ExploreAgentsPanel({ tasks }: { tasks: Msg[] | null }): React.ReactNode {
  const theme = getTheme()
  const safeTasks = Array.isArray(tasks) ? tasks : []

  if (safeTasks.length === 0) {
    return (
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>No Explore details available</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column">
        {safeTasks.map((t, idx) => {
          const last = idx === safeTasks.length - 1
          const branch = last ? '└─' : '├─'
          const pipe = last ? ' ' : '│'

          const toolUses = typeof t.toolInfo?.toolUses === 'number' ? t.toolInfo.toolUses : null
          const tokens = formatTokens(sumTokens(t.toolInfo?.usage))

          const statsParts: string[] = []
          if (toolUses !== null) statsParts.push(`${toolUses} tool use${toolUses === 1 ? '' : 's'}`)
          if (tokens !== '0') statsParts.push(`${tokens} tokens`)

          const stats = statsParts.length ? ` · ${statsParts.join(' · ')}` : ''

          const rawLabel = getTaskShortLabel(t)
          const baseLabel = /^Explore\b/i.test(rawLabel) ? rawLabel : `Explore ${rawLabel}`
          const label = truncate(baseLabel, 70)
          const line = `${label}${stats}`

          const doneWord =
            t.toolInfo?.status === 'running' ? 'Working' : t.toolInfo?.status === 'error' ? 'Error' : 'Done'

          return (
            <Box key={t.id} flexDirection="column">
              <Text>
                <Text color={theme.secondaryText}>  {branch} </Text>
                <Text>{line}</Text>
              </Text>
              <Text color={theme.secondaryText}>
                {'  '}
                {pipe}  ⎿  {doneWord}
              </Text>
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Showing Explore agents · ctrl+o to toggle</Text>
      </Box>
    </Box>
  )
}

function getTaskShortLabel(msg: Msg): string {
  const input = (msg.toolInfo?.input || {}) as any
  const description = typeof input?.description === 'string' ? input.description.trim() : ''
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : ''
  return description || prompt || 'Task'
}

export function formatTaskPanelTitle(msg: Msg): string {
  if (msg.role !== 'tool' || msg.toolInfo?.name !== 'Task') return 'Task'
  const input = (msg.toolInfo.input || {}) as any
  const subagentType = typeof input?.subagent_type === 'string' ? input.subagent_type.trim() : ''
  const toolLabel = subagentType ? (subagentType === 'code-reviewer' ? 'Reviewer' : subagentType) : 'Task'
  const description = typeof input?.description === 'string' ? input.description.trim() : ''
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : ''
  const params = truncate(description || prompt || '', 60)
  return params ? `${toolLabel}(${params})` : toolLabel
}

export function DetailedTranscriptPanel({
  title,
  lines,
}: {
  title: string | null
  lines: string[] | null
}): React.ReactNode {
  const theme = getTheme()
  const safeLines = Array.isArray(lines) ? lines : []

  return (
    <Box flexDirection="column" marginTop={1}>
      {title ? (
        <Box>
          <Text color={theme.secondaryText}>⎿  </Text>
          <Text>{title}</Text>
        </Box>
      ) : null}

      {safeLines.length > 0 ? (
        <Box flexDirection="column">
          {safeLines.map((line, idx) => {
            if (line === '') {
              return (
                <Box key={idx}>
                  <Text color={theme.secondaryText}>⎿  </Text>
                  <Text> </Text>
                </Box>
              )
            }
            return (
              <Box key={idx}>
                <Text color={theme.secondaryText}>⎿  </Text>
                <Text>{line}</Text>
              </Box>
            )
          })}
        </Box>
      ) : (
        <Box>
          <Text color={theme.secondaryText}>⎿  </Text>
          <Text color={theme.secondaryText}>No detailed transcript available</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Showing detailed transcript · ctrl+o to toggle</Text>
      </Box>
    </Box>
  )
}
