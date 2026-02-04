import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { createToolBlocksPresenter } from '../../presenters/types'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { ToolBlocksOutput } from '../../../components/tool/toolUiBlocksTypes'

export const TaskOutputToolPresenter = createToolBlocksPresenter(
  ({ message }: { message: Msg }): ToolBlocksOutput => {
  const theme = getTheme()

  if (!message.toolInfo) {
    return {
      blocks: [{ kind: 'header', status: 'completed', label: 'Unknown tool' }],
    }
  }

  const { input, status } = message.toolInfo

  const taskId = String((input as any)?.task_id || '')
  const raw = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  const parsed = parseTaskOutputResult(raw)

  const blocks: ToolBlocksOutput['blocks'] = [
    { kind: 'header', status, label: 'TaskOutput', params: taskId || 'unknown' },
  ]

  if (status !== 'running') {
    blocks.push({
      kind: 'subline',
      status: status === 'error' ? 'error' : 'completed',
      children:
        parsed.status === 'running' ? (
          <Text color={theme.secondaryText}>
            Running{parsed.timed_out ? ' (timed out waiting)' : ''}
          </Text>
        ) : parsed.is_error ? (
          <Text color={theme.error}>{parsed.output}</Text>
        ) : (
          <Text>{parsed.output}</Text>
        ),
    })

    if (parsed.status === 'running' && parsed.output) {
      blocks.push({
        kind: 'lines',
        lines: [{ tone: 'muted', text: parsed.output }],
      })
    }
  }

  return { blocks }
})

function parseTaskOutputResult(raw: string): {
  status: 'running' | 'completed' | 'error'
  output: string
  timed_out?: boolean
  is_error?: boolean
} {
  const trimmed = (raw || '').trim()
  if (!trimmed) return { status: 'completed', output: '(no output)' }

  try {
    const parsed = JSON.parse(trimmed)
    const status =
      parsed?.status === 'running' || parsed?.status === 'completed' || parsed?.status === 'error'
        ? parsed.status
        : 'completed'
    const output = typeof parsed?.output === 'string' ? parsed.output : ''
    const timedOut = Boolean(parsed?.timed_out)
    return { status, output, timed_out: timedOut, is_error: status === 'error' }
  } catch {
    return { status: 'completed', output: trimmed }
  }
}
