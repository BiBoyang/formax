import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { createToolBlocksPresenter } from '../../presenters/types'
import type { Msg } from '../../../shared/toolMessageTypes'
import type { ToolBlocksOutput } from '../../../shared/toolMessageTypes'

export const KillShellToolPresenter = createToolBlocksPresenter(
  ({ message }: { message: Msg }): ToolBlocksOutput => {
  const theme = getTheme()

  if (!message.toolInfo) {
    return {
      blocks: [{ kind: 'header', status: 'completed', label: 'Unknown tool' }],
    }
  }

  const { input, status } = message.toolInfo

  const shellId = String((input as any)?.shell_id || '')
  const raw = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  const parsed = parseKillShellResult(raw)

  const blocks: ToolBlocksOutput['blocks'] = [
    { kind: 'header', status, label: 'KillShell', params: shellId || 'unknown' },
  ]

  if (status !== 'running') {
    blocks.push({
      kind: 'subline',
      status: status === 'error' ? 'error' : 'completed',
      children: parsed.ok ? (
        <Text>Killed</Text>
      ) : status === 'error' ? (
        <Text color={theme.error}>{message.content || parsed.message || 'Failed'}</Text>
      ) : (
        <Text>{parsed.message || message.content}</Text>
      ),
    })
  }

  return { blocks }
})

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
