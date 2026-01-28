import React from 'react'
import path from 'node:path'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import { ConfirmMenu, type ConfirmMenuDecision } from '../../components/ui/ConfirmMenu.js'
import { ApprovalHeader } from './ApprovalHeader'

export type FsReadApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }

export function FsReadApprovalPrompt({
  title,
  directoryPath,
  onDecision,
}: {
  title: string
  directoryPath: string
  onDecision: (decision: FsReadApprovalDecision) => void
}): React.ReactNode {
  const theme = getTheme()
  const handleDecision = (d: ConfirmMenuDecision): void => {
    if (d.kind === 'cancel') onDecision({ kind: 'cancel' })
    else if (d.kind === 'feedback') onDecision({ kind: 'feedback', feedback: d.feedback })
    else if (d.key === 'approve') onDecision({ kind: 'approve' })
    else if (d.key === 'approve_remember') onDecision({ kind: 'approve_remember' })
  }

  const dirLabel = formatDirLabel(directoryPath)

  return (
    <Box flexDirection="column" marginTop={1}>
      <ApprovalHeader title={title} />

      <ConfirmMenu
        options={[
          { kind: 'choice', key: 'approve', label: 'Yes' },
          {
            kind: 'choice',
            key: 'approve_remember',
            label: `Yes, allow reading from ${dirLabel} during this session`,
            emphasis: { text: dirLabel, color: theme.text, bold: true },
          },
          {
            kind: 'feedback',
            key: 'feedback',
            label: '',
            placeholder: 'Type here to tell Claude what to do differently',
          },
        ]}
        onDecision={handleDecision}
        activeColor={theme.permission}
      />

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Esc to cancel</Text>
      </Box>
    </Box>
  )
}

function formatDirLabel(p: string): string {
  const raw = String(p || '').trim()
  if (!raw) return 'this directory'
  const base = path.basename(raw)
  if (!base) return `${raw}/`
  return `${base}/`
}
