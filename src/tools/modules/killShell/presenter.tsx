import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { ToolHeaderLine } from '../../../components/tool/ToolHeaderLine'
import { ToolSubline } from '../../../components/tool/ToolSubline'

export const KillShellToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo

  const shellId = String((input as any)?.shell_id || '')
  const raw = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  const parsed = parseKillShellResult(raw)

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <ToolHeaderLine status={status} label="KillShell" params={shellId || 'unknown'} />

      {status !== 'running' && (
        <Box flexDirection="column">
          <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
            {parsed.ok ? (
              <Text>Killed</Text>
            ) : status === 'error' ? (
              <Text color={theme.error}>{message.content || parsed.message || 'Failed'}</Text>
            ) : (
              <Text>{parsed.message || message.content}</Text>
            )}
          </ToolSubline>
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
