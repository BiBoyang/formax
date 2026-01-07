import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { PulsingDot } from '../../../components/ui/PulsingDot'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'

export const KillShellToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo
  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  const shellId = String((input as any)?.shell_id || '')
  const raw = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  const parsed = parseKillShellResult(raw)

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <PulsingDot color={dotColor} pulse={status === 'running'} />
        <Text> </Text>
        <Text bold>KillShell</Text>
        <Text color={theme.secondaryText}>(</Text>
        <Text color={theme.secondaryText}>{shellId || 'unknown'}</Text>
        <Text color={theme.secondaryText}>)</Text>
      </Box>

      {status !== 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            {parsed.ok ? (
              <Text>Killed</Text>
            ) : status === 'error' ? (
              <Text color={theme.error}>{message.content || parsed.message || 'Failed'}</Text>
            ) : (
              <Text>{parsed.message || message.content}</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}

function parseKillShellResult(raw: string): { ok: boolean; message?: string } {
  const trimmed = (raw || '').trim()
  if (!trimmed) return { ok: false }
  try {
    const parsed = JSON.parse(trimmed)
    return { ok: Boolean(parsed?.ok), message: typeof parsed?.status === 'string' ? parsed.status : undefined }
  } catch {
    return { ok: false }
  }
}
